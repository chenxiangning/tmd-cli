/**
 * 结构化会话 tab 内容 —— RPC 驱动(omp/pi `--mode rpc`),token 级流式转录 +
 * 自带输入面(能力见 ssComposer) + 审批回路。数据链:PiRpcSession(cli-shared)
 * ← kernel proc_stream 通用原语;PTY 零涉及。渲染复用 session-viewer 的
 * TranscriptView(极简联动同设置);关闭 tab = kill 子进程(useEffect 收割)。
 * 生命周期编排见 ssSession.ts。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { lazy, useEffect, useRef } from "react";
import type { EditorTab } from "@kernel/tabs";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { retryImport } from "@kernel/lazyImport";
import { SsHeader } from "./ssHeader";
import { SsActions } from "./ssActions";
import { LiveTurn } from "./liveTurn";
import { SsComposer } from "./ssComposer";
import { TranscriptView } from "@plugins/session-viewer/transcriptView";
import { useSsSession, type Phase } from "./ssSession";
import type { StructuredSessionPayload } from "./tabs";
import "./structured-session.css";

const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/* 滚动区相位横幅:启动中/启动失败/已结束(接续重开 = --resume 换壳,引擎
 * 上下文 + 转录保形;否则全复位新会话)。已结束用紧凑横幅,不占视口高空块。 */
function PhaseBanners(props: { phase: Phase; statusText: string | null; sessionId: string | null; resumable: boolean; onRetry: () => void }) {
  const { phase, statusText, resumable } = props;
  if (phase === "starting") return <div className="ss-empty">{t("启动 RPC 会话中…")}</div>;
  if (phase === "error") {
    return (
      <div className="ss-empty">
        {t("启动失败")}:{statusText}
        <button type="button" className="ss-retry" onClick={props.onRetry}>{t("重试")}</button>
      </div>
    );
  }
  if (phase === "exited") {
    return (
      <div className="ss-ended">
        {t("会话已结束(关闭此 tab 可再开)")}
        <button type="button" className="ss-retry" onClick={props.onRetry}>
          {resumable ? t("接续重开") : t("重新开启")}
        </button>
      </div>
    );
  }
  return null;
}

export function StructuredSessionTab({ tab }: { tab: EditorTab }) {
  useHost(); /* profile 注册/工作区变化 */
  const payload = tab.payload as StructuredSessionPayload;
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const profile = host.getCliProfile(payload.profileId);
  const ss = useSsSession(payload, tab.id);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* 贴底跟随(busy 流式期),上翻停跟。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && ss.stickRef.current) el.scrollTop = el.scrollHeight;
  }, [ss.blocks, ss.stickRef]);


  if (!profile?.structuredRpc) {
    return <div className="ss-root" data-icon-decor="structured-session"><div className="ss-empty">{t("该引擎不支持 RPC 会话")}</div></div>;
  }
  return (
    <div className="ss-root" data-icon-decor="structured-session">
      <SsHeader
        profileId={payload.profileId}
        cwd={payload.cwd}
        model={ss.model}
        thinkingLevel={ss.thinkingLevel}
        sessionId={ss.sessionId}
        stats={ss.stats}
        busy={ss.busy}
        queued={ss.queued}
        ready={ss.phase === "ready"}
        minimal={minimal}
        statusText={ss.statusText}
        warn={ss.phase === "ready" || ss.phase === "exited" ? ss.warn : null}
        session={ss.sessionRef.current}
        actions={<SsActions ss={ss} payload={payload} tab={tab} />}
        onStateRefresh={(s) => ss.onStateRefresh(s)}
        onAbort={() => void ss.sessionRef.current?.abort()}
        onDismissWarn={ss.dismissWarn}
      />
      <div
        className="ss-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) ss.stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
        }}
      >
        <PhaseBanners
          phase={ss.phase}
          statusText={ss.statusText}
          sessionId={ss.sessionId}
          resumable={!!profile.structuredRpc.resumeArgs && !!ss.sessionId}
          onRetry={ss.retry}
        />

        {ss.blocks.length > 0 ? (
          <div className="ss-blocks">
            <TranscriptView blocks={ss.blocks.slice(0, ss.turnStart)} Markdown={MarkdownBody} minimal={minimal} />
            <LiveTurn blocks={ss.blocks.slice(ss.turnStart)} busy={ss.busy} Markdown={MarkdownBody} thinkingLabel={t("思考中…")} />
          </div>
        ) : null}
      </div>
      {/* working 带移出滚动区(flex:none 底带):长轮次卷走看不见、与 860px 列错位两症同治 */}
      {ss.busy ? (
        <div className="ss-working">
          <span className="ss-spin-grid" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
          <span className="ss-working-who">{ss.model?.id ?? profile.name}</span>
          <span className="ss-working-for">{t("working for")}{ss.elapsed}s</span>
        </div>
      ) : null}
      <SsComposer ss={ss} profileId={payload.profileId} cwd={payload.cwd} />
    </div>
  );
}
