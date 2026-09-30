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
import { useSettingsState } from "@kernel/settings";
import type { CliTranscriptBlock } from "@kernel/cli";
import { retryImport } from "@kernel/lazyImport";
import { LiveTurn } from "./liveTurn";
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

  /* 生命周期:mount 起 RPC 子进程,unmount(关 tab)kill 收割。StrictMode 双跑
   * 由 startedRef 挡;会话身份取首拍(get_state),失败进 error 态可重试。 */
  const startedRef = useRef(false);
  useEffect(() => {
    const rpc = host.getCliProfile(payload.profileId)?.structuredRpc;
    if (startedRef.current || !rpc) return;
    startedRef.current = true;
    const session = new PiRpcSession(
      rpc,
      payload.cwd,
      {
        onBlocks: (next, ts) => {
          setBlocks(next);
          setTurnStart(ts);
        },
        onBusy: (b) => {
          setBusy(b);
          setBusySince(b ? Date.now() : null);
        },
        onConfirm: setConfirm,
        onExit: () => setPhase("exited"),
        onError: (msg) => setStatusText(msg),
      },
    );
    sessionRef.current = session;
    void session
      .start()
      .then((state) => {
        setSessionId(state?.sessionId ?? null);
        setModel(state?.model ?? null);
        setPhase("ready");
      })
      .catch((e: unknown) => {
        setStatusText(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
    return () => {
      startedRef.current = false;
      session.kill();
      sessionRef.current = null;
    };
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
    void sessionRef.current?.send(text).catch((e: unknown) =>
      setStatusText(e instanceof Error ? e.message : String(e)));
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
        {phase === "error" ? <div className="ss-empty">{t("启动失败")}:{statusText}</div> : null}
        {phase === "exited" ? <div className="ss-empty">{t("会话已结束(关闭此 tab 可再开)")}</div> : null}
        {busy ? (
          <div className="ss-working">
            <span className="ss-spin" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
            <span className="ss-working-who">{model ?? profile.name}</span>
            <span className="ss-working-for">{t("working for")}{elapsed}s</span>
          </div>
        ) : null}

        {blocks.length > 0 ? (
          <div className="ss-blocks">
            <TranscriptView blocks={blocks.slice(0, turnStart)} Markdown={MarkdownBody} minimal={minimal} />
            <LiveTurn blocks={blocks.slice(turnStart)} busy={busy} Markdown={MarkdownBody} thinkingLabel={t("思考中…")} />
          </div>
        ) : null}
      </div>
      {confirm ? (
        <div className="ss-confirm">
          <div className="ss-confirm-title">{confirm.title || t("等待确认")}</div>
          <div className="ss-confirm-message">{confirm.message}</div>
          <div className="ss-confirm-actions">
            <button
              type="button"
              className="ss-confirm-deny"
              onClick={() => {
                sessionRef.current?.respond(confirm.frameId, false);
                setConfirm(null);
              }}
            >
              {t("拒绝")}
            </button>
            <button
              type="button"
              className="ss-confirm-approve"
              onClick={() => {
                sessionRef.current?.respond(confirm.frameId, true);
                setConfirm(null);
              }}
            >
              {t("批准")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="ss-input">
        <textarea
          className="ss-textarea"
          value={draft}
          placeholder={phase === "ready" ? t("发消息(结构化会话,无幕布)") : t("会话未就绪")}
          disabled={phase !== "ready"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
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
