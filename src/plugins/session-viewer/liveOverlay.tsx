/**
 * 活会话转录浮层 —— 结构化视图全景的画布覆盖 UI(editorCenter.canvasOverlay
 * 挂点;入口切换钮 = livePill.tsx,经 terminal.canvasRow 挂点并入幕布右上工具行)。
 * 命名契约:入口「结构化视图」/ 出口「PTY实况」,两面一致。
 * 幕布保活零卸载(覆盖不替换,PTY 链路零改动);数据 = 1s 探测短路轮询
 * (fsReadTailChanged 尺寸未变零读取)+ 变更拍 readChangedTranscript(JSONL
 * 家族增量段解析,2026-10-06:8MB+ 大转录不再全量重读;未声明家族回落全量;
 * message 级刷新,JSONL 事件级追加,无 token 粒度——omp 全事件类型实证)。
 * 设计:docs/superpowers/specs/2026-09-30-live-transcript-view-design.md
 */
import { lazy, useEffect, useReducer, useRef, useState } from "react";
import { host, useHost } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import type { CliDiskSession, CliTranscriptBlock } from "@kernel/cli";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { Chats } from "@phosphor-icons/react";
import { retryImport } from "@kernel/lazyImport";
import { TranscriptView } from "./transcriptView";
import { setLiveTranscript, isLiveTranscript, subscribeLiveMode, tailWindow, decideProbe, stableBlocks, readChangedTranscript, type LiveTailState } from "./liveMode";
/* md 渲染管线体积大,按需拆包(与 viewerTab 同款纪律)。 */
const MarkdownBody = lazy(retryImport(() =>
  import("./markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/** 轮询节拍:message 级落盘事件,1s 探测足够跟手且空转成本一次 stat。 */
const POLL_MS = 1000;
/** 路径解析限频:listSessions 是目录全扫(grok 千级会话),3s 一试到命中;连续 miss ≥10 次(约 30s)退到 10s 节拍,防未绑定/懒落盘期常驻全扫。 */
const RESOLVE_EVERY = 3;
/** 尾窗批次:live 视角从尾部往回看(与查看 tab 同额)。 */
const RENDER_BATCH = 200;
/** 贴底跟随判定边距。 */ const FOLLOW_EDGE = 60;

/* 轮询状态机组件:分支密度是本质复杂度,拆散闭包需传 6 个 ref 弊大于利。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function LiveTranscriptOverlay() {
  useHost(); /* 活跃指针 / 会话表 / profile 注册变化 */
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const activeId = host.getActiveSessionId();
  const meta = activeId ? host.getSessions().find((s) => s.id === activeId) : undefined;
  const profile = meta ? host.getCliProfile(meta.engine ?? meta.profileId) : undefined;
  /* 能力门:引擎带转录读取器才出浮层(内核规则:缺失显示 —,不猜测兜底)。 */
  const capable = !!activeId && meta?.kind !== "shell" && !!profile?.readSessionTranscript;
  const on = !!activeId && capable && isLiveTranscript(activeId);

  /* 模式 store 订阅:本组件自己切换/会话退出剪除都触发重渲染。 */
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLiveMode(force), [force]);

  const [error, setError] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [retryTick, setRetryTick] = useState(0); /* 持久条「重试」拍子:重拍轮询 effect */
  const [blocks, setBlocks] = useState<CliTranscriptBlock[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [visible, setVisible] = useState(RENDER_BATCH);
  /** 轮次进行中(host.isTurnActive 会话生命周期,呼吸灯/会话 tab「运行中」同源):
   *  working 带 + 卷尾流式观感。 */
  const [turnActive, setTurnActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sinceRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const diskRef = useRef<CliDiskSession | null>(null);
  /** 连续探错计数:重定位命中后第二次探错即熔断(路径非可读文件)。 */
  const probeFailRef = useRef(0);
  /** 定位 miss 计数:退避节拍用(命中/会话切换归零)。 */
  const resolveMissRef = useRef(0);
  const sizeRef = useRef<number | null>(null);
  /** 贴底跟随的渲染态镜像(ref 驱滚动逻辑,state 驱「回到底部」浮标显隐)。 */
  const stickRef = useRef(true);
  /** 增量尾读状态(见 liveMode.readChangedTranscript):raw 累计原始块,
   *  offset 行对齐续读偏移,truncated 首读定格。 */
  const tailRef = useRef<LiveTailState>({ raw: null, offset: null, truncated: false });
  const [atBottom, setAtBottom] = useState(true);
  const pendingRestoreRef = useRef<{ height: number; top: number } | null>(null);

  /* 会话/模式切换即整态复位(先于轮询 effect 声明,同拍先清后跑)。 */
  useEffect(() => {
    diskRef.current = null;
    tailRef.current = { raw: null, offset: null, truncated: false };
    stickRef.current = true;
    setAtBottom(true);
    pendingRestoreRef.current = null;
    sinceRef.current = null;
    setTurnActive(false);
    setBlocks(null);
    setTruncated(false);
    setVisible(RENDER_BATCH);
    setError(false);
    setUnsupported(false);
    probeFailRef.current = 0;
    resolveMissRef.current = 0;
  }, [activeId, on]);

  /* 轮询:定位磁盘会话 → 尺寸探测短路 → 变更拍增量/全量读取(readChangedTranscript)。 */
  useEffect(() => {
    if (!on || !activeId || !profile?.readSessionTranscript || !meta?.cwd) return;
    const listSessions = profile.listSessions;
    let stopped = false;
    let tick = 0;
    let timer: NodeJS.Timeout | undefined;
    const poll = async (): Promise<void> => {
      if (!diskRef.current) {
        /* IdentityLedger.bind 无宿主通知,靠轮询节拍重查(通常秒级绑定)。 */
        const cliId = host.getCliSessionId(activeId);
        if (!cliId || !listSessions || tick % (resolveMissRef.current >= 10 ? 10 : RESOLVE_EVERY) !== 1) return;
        const list = await listSessions(meta.cwd).catch(() => null);
        if (stopped) return;
        const hit = list?.find((s) => s.id === cliId);
        if (hit) {
          diskRef.current = hit; /* 命中后下一拍起探测读取 */
          resolveMissRef.current = 0;
        } else resolveMissRef.current += 1;
        return;
      }
      const probe = await ipc
        .fsReadTailChanged(diskRef.current.path, 1, sizeRef.current)
        .catch(() => null);
      if (stopped) return;
      const { decision, failStreak } = decideProbe(probe, probeFailRef.current);
      probeFailRef.current = failStreak;
      if (decision === "terminal") {
        diskRef.current = null;
        setUnsupported(true);
        clearInterval(timer);
        timer = undefined;
        return;
      }
      if (decision === "relocate") {
        diskRef.current = null; /* 文件消失/不可读:清缓存重定位 */
        return;
      }
      if (decision !== "read" || !probe || !probe.changed) return;
      const next = await readChangedTranscript(profile, diskRef.current, probe.size, tailRef.current);
      if (stopped) return;
      sizeRef.current = probe.size;
      if (!next) {
        setError(true);
        return;
      }
      setBlocks((prev) => stableBlocks(prev, next.blocks));
      setTruncated(next.truncated);
      setError(false);
    };
    const step = async () => {
      if (stopped) return;
      tick += 1;
      try {
        /* 早退return安全:收带判定在 try 外,每拍必达(此前焊死在「变了才判」路径上)。 */
        await poll();
      } catch {
        if (!stopped) setError(true);
      }
      if (stopped) return;
      /* working 带/卷尾流式观感 = 会话轮次生命周期(host.isTurnActive,呼吸灯与
       * 会话 tab「运行中」同源):运行时即 loading 期,开视图即在途也立亮;静默段
       * 持轮由 busyMarks/busyHoldMs 自证(omp 冻结 75s 宽窗),不再从磁盘增长猜。 */
      const alive = host.isTurnActive(activeId);
      if (alive && sinceRef.current === null) sinceRef.current = Date.now();
      if (!alive) sinceRef.current = null;
      setTurnActive(alive);
    };
    void step();
    timer = setInterval(() => void step(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
    };
  }, [on, activeId, profile, meta?.cwd, retryTick]);

  /* working 计时(monocode LiveFoldTitle):活跃期每秒跳。 */
  useEffect(() => {
    if (!turnActive) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsed(sinceRef.current ? Math.max(1, Math.round((Date.now() - sinceRef.current) / 1000)) : 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [turnActive]);

  /* 贴底自动跟随 + 回溯滚动锚点恢复(实况行更新同跟随)。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pending = pendingRestoreRef.current;
    if (pending) {
      pendingRestoreRef.current = null;
      el.scrollTop = el.scrollHeight - pending.height + pending.top;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [blocks, visible]);

  if (!activeId || !capable || !on) return null;

  const shown = tailWindow(blocks ?? [], visible);
  /* 状态三分流:错误(含 unsupported)走持久条 role=alert + 重试,不抹已到转录;空态走 Empty;定位中走 Spinner。 */
  const errMsg = unsupported ? t("该引擎不支持实时转录") : error ? t("读取会话转录失败") : null;
  const retryLocate = () => { /* 清错误/熔断与定位缓存,重拍轮询 effect */
    tailRef.current = { raw: null, offset: null, truncated: false }; setError(false); setUnsupported(false);
    probeFailRef.current = 0; resolveMissRef.current = 0; diskRef.current = null; sizeRef.current = null;
    setRetryTick((v) => v + 1);
  };

  return (
    <div className="sv-root lv-view">
      <header className="sv-header">
        {profile.renderIcon ? <span className="sv-engine-icon">{profile.renderIcon("0.875rem")}</span> : null}
        {/* 主标题 = 会话展示名;引擎会话 id 降为次要 mono 小字(此前 8 位哈希当标题) */}
        <span className="sv-title">{meta?.title || t("未命名会话")}</span>
        <span className="sv-sid">{host.getCliSessionId(activeId)?.slice(0, 8) ?? activeId.slice(0, 8)}</span>
        <span className="sv-engine-name">{profile.name}</span>
        {truncated ? <span className="sv-truncated">{t("会话过大,已截断")}</span> : null}
        <button
          type="button"
          className={`sv-minimal${minimal ? " is-on" : ""}`}
          aria-pressed={minimal}
          title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
          onClick={() => updateSettings({ sessionViewerMinimal: !minimal })}
        >
          {t("极简")}
        </button>
        <button
          type="button"
          className="lv-close"
          title={t("返回 PTY 实况")}
          onClick={() => setLiveTranscript(activeId, false)}
        >
          {t("PTY实况")}
        </button>
      </header>
      <div
        className="sv-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) {
            const at = el.scrollTop + el.clientHeight >= el.scrollHeight - FOLLOW_EDGE;
            stickRef.current = at;
            setAtBottom(at);
          }
        }}
      >
        {errMsg !== null && (
          <div className="lv-error" role="alert"><span>{errMsg}</span><button type="button" className="lv-error-retry" onClick={retryLocate}>{t("重试")}</button></div>
        )}
        {errMsg === null && blocks === null && <div className="sv-empty"><span className="inline-flex items-center gap-2"><Spinner />{t("定位会话文件中…")}</span></div>}
        {errMsg === null && blocks?.length === 0 && <div className="sv-empty"><Empty icon={<Chats size="0.875rem" />}>{t("会话没有可解析的对话内容")}</Empty></div>}
        {blocks !== null && blocks.length > 0 && (
          <div className="sv-blocks">
            {visible < (blocks?.length ?? 0) ? (
              <button
                type="button"
                className="sv-more"
                onClick={() => {
                  const el = scrollRef.current;
                  if (el) pendingRestoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
                  setVisible((v) => v + RENDER_BATCH);
                }}
              >
                {t("载入更早")}
              </button>
            ) : null}
            <TranscriptView blocks={shown} Markdown={MarkdownBody} minimal={minimal} streaming={turnActive} />
          </div>
        )}
      </div>
      {turnActive ? (
        <div className="lv-working">
          <span className="lv-spin" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
          </span>
          <span className="lv-working-who">{profile.name}</span>
          <span className="lv-working-for">{t("working for")}{elapsed}s</span>
        </div>
      ) : null}
      {/* 上翻停跟后的回底出口(流式仍在涨,不拽用户视线,只给一键回底) */}
      {!atBottom ? (
        <button
          type="button"
          className="lv-backto"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            stickRef.current = true;
            setAtBottom(true);
          }}
        >
          {t("回到底部")}
        </button>
      ) : null}
    </div>
  );
}
