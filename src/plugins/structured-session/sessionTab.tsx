/**
 * 结构化会话 tab 内容 —— RPC 驱动(omp/pi `--mode rpc`),token 级流式转录 +
 * 自带输入面 + 审批回路。数据链:PiRpcSession(cli-shared)← kernel proc_stream
 * 通用原语;PTY 零涉及。渲染复用 session-viewer 的 TranscriptView(极简联动
 * 同设置);关闭 tab = kill 子进程(useEffect 收割)。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { lazy, useEffect, useRef, useState } from "react";
import type { EditorTab } from "@kernel/tabs";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState, updateSettings } from "@kernel/settings";
import type { CliTranscriptBlock } from "@kernel/cli";
import { retryImport } from "@kernel/lazyImport";
import { LiveTurn } from "./liveTurn";
import { ConfirmCard } from "./confirmCard";
import type { StructuredSessionPayload } from "./tabs";
import { TranscriptView } from "@plugins/session-viewer/transcriptView";
import {
  PiRpcSession,
  type PiRpcConfirm,
} from "../cli-shared/piRpc";
import "./structured-session.css";

const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));


type Phase = "starting" | "ready" | "exited" | "error";

/* RPC 会话壳:生命周期/审批/输入面集中编排,分支是协议状态机的本质复杂度。 */
// react-doctor-disable-next-line react-doctor/no-high-complexity-react-function
export function StructuredSessionTab({ tab }: { tab: EditorTab }) {
  useHost(); /* profile 注册/工作区变化 */
  const payload = tab.payload as StructuredSessionPayload;
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const profile = host.getCliProfile(payload.profileId);
  const [phase, setPhase] = useState<Phase>("starting");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<CliTranscriptBlock[]>([]);
  const [turnStart, setTurnStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [busySince, setBusySince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [confirm, setConfirm] = useState<PiRpcConfirm | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const sessionRef = useRef<PiRpcSession | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /* token 级 delta 30-80 事件/s:攒 120ms 尾沿合帧再进 React(流式观感无差,
   * 相位级 useMemo 与活块 markdown 重解析降频一个量级)。 */
  const pendingBlocksRef = useRef<[CliTranscriptBlock[], number] | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const flushBlocks = () => {
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingBlocksRef.current;
    if (pending) {
      pendingBlocksRef.current = null;
      setBlocks(pending[0]);
      setTurnStart(pending[1]);
    }
  };

  /* 生命周期:mount 起 RPC 子进程,unmount(关 tab)kill 收割。StrictMode 双跑
   * 由 startedRef 挡;失败先 kill 清残留子进程再进 error 态,重试按钮重跑启动。 */
  const startedRef = useRef(false);
  const startSession = () => {
    const rpc = host.getCliProfile(payload.profileId)?.structuredRpc;
    if (startedRef.current || !rpc) return;
    startedRef.current = true;
    setPhase("starting");
    setStatusText(null);
    let self: PiRpcSession;
    const session = (self = new PiRpcSession(
      rpc,
      payload.cwd,
      {
        onBlocks: (next, ts) => {
          pendingBlocksRef.current = [next, ts];
          if (flushTimerRef.current == null) {
            flushTimerRef.current = window.setTimeout(() => {
              flushTimerRef.current = null;
              flushBlocks();
            }, 120);
          }
        },
        onBusy: (b) => {
          setBusy(b);
          setBusySince(b ? Date.now() : null);
        },
        onConfirm: setConfirm,
        onExit: () => {
          if (sessionRef.current === self) {
            flushBlocks();
            setConfirm(null);
            setBusy(false);
            setBusySince(null);
            setPhase("exited");
          }
        },
        onError: (msg) => setStatusText(msg),
      },
    ));
    sessionRef.current = session;
    void session
      .start()
      .then((state) => {
        if (sessionRef.current !== session) return;
        setSessionId(state?.sessionId ?? null);
        setModel(state?.model ?? null);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        /* 启动失败:先收割残留子进程,再进可重试的 error 态。 */
        session.kill();
        if (sessionRef.current === session) {
          sessionRef.current = null;
          setStatusText(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      });
  };
  const retry = () => {
    flushBlocks();
    sessionRef.current?.kill();
    sessionRef.current = null;
    startedRef.current = false;
    setBlocks([]);
    setTurnStart(0);
    setConfirm(null);
    setBusy(false);
    startSession();
  };
  useEffect(() => {
    startSession();
    return () => {
      startedRef.current = false;
      clearTimeout(flushTimerRef.current ?? undefined);
      sessionRef.current?.kill();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.profileId, payload.cwd]);

  /* 贴底跟随(busy 流式期),上翻停跟。 */
  const stickRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [blocks]);

  /* working 头计时(monocode「working for Ns」同语义):busy 起跳,结算归零。 */
  useEffect(() => {
    if (busySince === null) return;
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - busySince) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [busySince]);

  const send = () => {
    const text = draft.trim();
    if (!text || phase !== "ready" || busy) return;
    setDraft("");
    stickRef.current = true;
    void sessionRef.current?.send(text).catch((e: unknown) => {
      setStatusText(e instanceof Error ? e.message : String(e));
      /* 发送失败保输入(桌面契约):仅在用户未另起输入时回填。 */
      setDraft((d) => (d === "" ? text : d));
    });
  };
  /* 审批应答(ConfirmCard 回路):应答即收卡,重复应答按无 confirm 短路。 */
  const answerConfirm = (ok: boolean) => {
    const cur = confirm;
    if (!cur) return;
    sessionRef.current?.respond(cur.frameId, ok);
    setConfirm(null);
  };
  /* 输入框随手长高(两行式,桌面上限同款 180px;CSS overflow 兜底滚动)。 */
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  if (!profile?.structuredRpc) {
    return <div className="ss-root"><div className="ss-empty">{t("该引擎不支持结构化会话")}</div></div>;
  }

  return (
    <div className="ss-root">
      <header className="ss-header">
        {profile.renderIcon ? <span className="ss-engine-icon">{profile.renderIcon("0.875rem")}</span> : null}
        <span className="ss-engine-name">{profile.name}</span>
        <span className="ss-cwd">{payload.cwd}</span>
        {model ? <span className="ss-model">{model}</span> : null}
        {sessionId ? <span className="ss-sid">{sessionId.slice(0, 8)}</span> : null}
        {/* 极简展示切换(形制同 viewer 头 sv-minimal;设置同源全局生效) */}
        <button
          type="button"
          className={"ss-minimal" + (minimal ? " is-on" : "")}
          title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
          aria-pressed={minimal}
          onClick={() => updateSettings({ sessionViewerMinimal: !minimal })}
        >
          {t("极简")}
        </button>
        <span className={`ss-dot${busy ? " is-busy" : ""}`} title={busy ? t("生成中") : t("空闲")} />
        {statusText ? <span className="ss-status" title={statusText}>{statusText.slice(0, 80)}</span> : null}
        {busy ? (
          <button type="button" className="ss-abort" onClick={() => void sessionRef.current?.abort()}>
            {t("中止")}
          </button>
        ) : null}
      </header>
      <div
        className="ss-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
        }}
      >
        {phase === "starting" ? <div className="ss-empty">{t("启动 RPC 会话中…")}</div> : null}
        {phase === "error" ? (
          <div className="ss-empty">
            {t("启动失败")}:{statusText}
            <button type="button" className="ss-retry" onClick={retry}>{t("重试")}</button>
          </div>
        ) : null}
        {/* 已结束 = 紧凑横幅(不再视口高空块把残留内容顶出视野);重新开启 =
            重跑该引擎 spawn 链(retry 同源:kill 残骸 → 全态复位 → 再握手)。 */}
        {phase === "exited" ? (
          <div className="ss-ended">
            {t("会话已结束(关闭此 tab 可再开)")}
            <button type="button" className="ss-retry" onClick={retry}>{t("重新开启")}</button>
          </div>
        ) : null}

        {blocks.length > 0 ? (
          <div className="ss-blocks">
            <TranscriptView blocks={blocks.slice(0, turnStart)} Markdown={MarkdownBody} minimal={minimal} />
            <LiveTurn blocks={blocks.slice(turnStart)} busy={busy} Markdown={MarkdownBody} thinkingLabel={t("思考中…")} />
          </div>
        ) : null}
      </div>
      {/* working 带移出滚动区(flex:none 底带):长轮次卷走看不见、与 860px 列错位两症同治 */}
      {busy ? (
        <div className="ss-working">
          <span className="ss-spin-grid" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
          <span className="ss-working-who">{model ?? profile.name}</span>
          <span className="ss-working-for">{t("working for")}{elapsed}s</span>
        </div>
      ) : null}
      {confirm ? <ConfirmCard key={confirm.frameId} confirm={confirm} onAnswer={answerConfirm} /> : null}
      <div className="ss-input">
        <textarea
          className="ss-textarea"
          value={draft}
          placeholder={phase === "ready" ? t("发消息(Enter 发送,Shift+Enter 换行)") : t("会话未就绪")}
          disabled={phase !== "ready"}
          onChange={(e) => setDraft(e.target.value)}
          onInput={(e) => autoResize(e.currentTarget)}
          onKeyDown={(e) => {
            /* confirm 在卡:Esc 拒绝;Enter 不再批准(打字误敲是最高频误批准源),
               批准经卡内按钮;composing 让路输入法 */
            if (confirm && !e.nativeEvent.isComposing && e.key === "Escape") {
              e.preventDefault();
              answerConfirm(false);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="ss-send" disabled={phase !== "ready" || busy || !draft.trim()} onClick={send}>
          {t("发送")}
        </button>
      </div>
    </div>
  );
}
