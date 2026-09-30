/**
 * 活会话转录浮层 —— 结构化幕布全景视图的画布覆盖 UI(editorCenter.canvasOverlay
 * 挂点;入口切换钮 = livePill.tsx,经 terminal.canvasRow 挂点并入幕布右上工具行)。
 * 幕布保活零卸载(覆盖不替换,PTY 链路零改动);数据 = 1s 探测短路轮询
 * (fsReadTailChanged 尺寸未变零读取)+ 变更即 readSessionTranscript 全量重读
 * (message 级刷新:JSONL 事件级追加,无 token 粒度——omp 全事件类型实证无
 * ponytail: 全量重读在超大转录(8MB+)每秒约百毫秒主线程;升级路径 = 契约暴露
 * per-family lineOf 做尾窗增量解析。
 * 设计:docs/superpowers/specs/2026-09-30-live-transcript-view-design.md
 */
import { lazy, useEffect, useReducer, useRef, useState } from "react";
import { host, useHost } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { updateSettings, useSettingsState } from "@kernel/settings";
import type { CliDiskSession, CliTranscriptBlock } from "@kernel/cli";
import { retryImport } from "@kernel/lazyImport";
import { TranscriptView } from "./transcriptView";
import { setLiveTranscript, isLiveTranscript, subscribeLiveMode, tailWindow } from "./liveMode";

/* md 渲染管线体积大,按需拆包(与 viewerTab 同款纪律)。 */
const MarkdownBody = lazy(retryImport(() =>
  import("./markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/** 轮询节拍:message 级落盘事件,1s 探测足够跟手且空转成本一次 stat。 */
const POLL_MS = 1000;
/** 路径解析限频:listSessions 是目录全扫(grok 千级会话),3s 一试到命中。 */
const RESOLVE_EVERY = 3;
/** 尾窗批次:live 视角从尾部往回看(与查看 tab 同额)。 */
const RENDER_BATCH = 200;
/** 贴底跟随判定边距。 */
const FOLLOW_EDGE = 60;
/** working 带闭锁:最后活信号(转录磁盘增长)静默超此值收带。 */
const BAND_HOLD_MS = 15_000;

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
  const [blocks, setBlocks] = useState<CliTranscriptBlock[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [visible, setVisible] = useState(RENDER_BATCH);
  /** 轮次进行中(kernel 呼吸灯同源):working 带 + 卷尾流式观感。 */
  const [turnActive, setTurnActive] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sinceRef = useRef<number | null>(null);
  /** 带闭锁:alive 信号 = 转录磁盘增长(内核活动钟在 pi alt-screen 静默段会假熄,不采用);
   *  静默超 HOLD 才收带。 */
  const lastSignalRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const diskRef = useRef<CliDiskSession | null>(null);
  const sizeRef = useRef<number | null>(null);
  const stickRef = useRef(true);
  const pendingRestoreRef = useRef<{ height: number; top: number } | null>(null);

  /* 会话/模式切换即整态复位(先于轮询 effect 声明,同拍先清后跑)。 */
  useEffect(() => {
    diskRef.current = null;
    sizeRef.current = null;
    stickRef.current = true;
    pendingRestoreRef.current = null;
    lastSignalRef.current = 0;
    setTurnActive(false);
    setBlocks(null);
    setTruncated(false);
    setVisible(RENDER_BATCH);
    setError(false);
  }, [activeId, on]);

  /* 轮询:定位磁盘会话 → 尺寸探测短路 → 变更全量重读。 */
  useEffect(() => {
    if (!on || !activeId || !profile?.readSessionTranscript || !meta?.cwd) return;
    const reader = profile.readSessionTranscript;
    const listSessions = profile.listSessions;
    let stopped = false;
    let tick = 0;
    const poll = async (): Promise<void> => {
      if (!diskRef.current) {
        /* IdentityLedger.bind 无宿主通知,靠轮询节拍重查(通常秒级绑定)。 */
        const cliId = host.getCliSessionId(activeId);
        if (!cliId || !listSessions || tick % RESOLVE_EVERY !== 1) return;
        const list = await listSessions(meta.cwd).catch(() => null);
        if (stopped) return;
        const hit = list?.find((s) => s.id === cliId);
        if (hit) diskRef.current = hit; /* 命中后下一拍起探测读取 */
        return;
      }
      const probe = await ipc
        .fsReadTailChanged(diskRef.current.path, 1, sizeRef.current)
        .catch(() => null);
      if (stopped) return;
      if (!probe) {
        diskRef.current = null; /* 文件消失/不可读:清缓存重定位 */
        return;
      }
      if (probe.changed && sizeRef.current !== null) {
        /* 增量增长才武装(首读是建基线,不是活动证据——空闲会话开视图不冒带)。 */
        lastSignalRef.current = Date.now();
        if (sinceRef.current === null) sinceRef.current = Date.now();
      }
      if (!probe.changed) return;
      const transcript = await reader(diskRef.current);
      if (stopped) return;
      sizeRef.current = probe.size;
      if (!transcript) {
        setError(true);
        return;
      }
      setBlocks(transcript.blocks);
      setTruncated(transcript.truncated ?? false);
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
      const alive = Date.now() - lastSignalRef.current < BAND_HOLD_MS;
      if (alive && sinceRef.current === null) sinceRef.current = Date.now();
      if (!alive) sinceRef.current = null;
      setTurnActive(alive);
    };
    void step();
    const timer = setInterval(() => void step(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on, activeId, profile, meta?.cwd]);


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
  const statusText =
    error
      ? t("读取会话转录失败")
      : blocks === null
        ? t("定位会话文件中…")
        : blocks.length === 0
          ? t("会话没有可解析的对话内容")
          : null;

  return (
    <div className="sv-root lv-view">
      <header className="sv-header">
        {profile.renderIcon ? <span className="sv-engine-icon">{profile.renderIcon("0.875rem")}</span> : null}
        <span className="sv-title">{host.getCliSessionId(activeId)?.slice(0, 8) ?? activeId.slice(0, 8)}</span>
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
          title={t("返回 PTY 流实况显示")}
          onClick={() => setLiveTranscript(activeId, false)}
        >
          {t("PTY流")}
        </button>
      </header>
      <div
        className="sv-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - FOLLOW_EDGE;
        }}
      >
        {statusText ? <div className="sv-empty">{statusText}</div> : (
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
    </div>
  );
}
