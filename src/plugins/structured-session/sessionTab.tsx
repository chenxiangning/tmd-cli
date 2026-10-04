/**
 * 结构化会话 tab 内容 —— RPC 驱动(omp/pi `--mode rpc`),token 级流式转录 +
 * 自带输入面 + 审批回路。数据链:PiRpcSession(cli-shared)← kernel proc_stream
 * 通用原语;PTY 零涉及。渲染复用 session-viewer 的 TranscriptView(极简联动
 * 同设置);关闭 tab = kill 子进程(useEffect 收割)。生命周期编排见 ssSession.ts。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { lazy, useEffect, useRef } from "react";
import type { EditorTab } from "@kernel/tabs";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { retryImport } from "@kernel/lazyImport";
import { SsHeader } from "./ssHeader";
import { LiveTurn } from "./liveTurn";
import { ConfirmCard } from "./confirmCard";
import { TranscriptView } from "@plugins/session-viewer/transcriptView";
import { useSsSession } from "./ssSession";
import type { StructuredSessionPayload } from "./tabs";
import "./structured-session.css";

const MarkdownBody = lazy(retryImport(() =>
  import("@plugins/session-viewer/markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

export function StructuredSessionTab({ tab }: { tab: EditorTab }) {
  useHost(); /* profile 注册/工作区变化 */
  const payload = tab.payload as StructuredSessionPayload;
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const profile = host.getCliProfile(payload.profileId);
  const ss = useSsSession(payload);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* 贴底跟随(busy 流式期),上翻停跟。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && ss.stickRef.current) el.scrollTop = el.scrollHeight;
  }, [ss.blocks, ss.stickRef]);

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
      <SsHeader
        profileId={payload.profileId}
        cwd={payload.cwd}
        model={ss.model}
        thinkingLevel={ss.thinkingLevel}
        sessionId={ss.sessionId}
        busy={ss.busy}
        queued={ss.queued}
        ready={ss.phase === "ready"}
        minimal={minimal}
        statusText={ss.statusText}
        session={ss.sessionRef.current}
        onStateRefresh={(s) => ss.onStateRefresh(s)}
        onAbort={() => void ss.sessionRef.current?.abort()}
      />
      <div
        className="ss-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el) ss.stickRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
        }}
      >
        {ss.phase === "starting" ? <div className="ss-empty">{t("启动 RPC 会话中…")}</div> : null}
        {ss.phase === "error" ? (
          <div className="ss-empty">
            {t("启动失败")}:{ss.statusText}
            <button type="button" className="ss-retry" onClick={ss.retry}>{t("重试")}</button>
          </div>
        ) : null}
        {/* 已结束 = 紧凑横幅(不再视口高空块把残留内容顶出视野);重新开启 =
            retry 同源:可接续(--resume 换壳,引擎上下文 + 转录保形)否则全复位新会话。 */}
        {ss.phase === "exited" ? (
          <div className="ss-ended">
            {t("会话已结束(关闭此 tab 可再开)")}
            <button type="button" className="ss-retry" onClick={ss.retry}>
              {profile.structuredRpc.resumeArgs && ss.sessionId ? t("接续重开") : t("重新开启")}
            </button>
          </div>
        ) : null}

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
      {ss.confirm ? <ConfirmCard key={ss.confirm.frameId} confirm={ss.confirm} onAnswer={ss.answerConfirm} /> : null}
      <div className="ss-input">
        <textarea
          className="ss-textarea"
          value={ss.draft}
          placeholder={ss.phase !== "ready" ? t("会话未就绪") : ss.busy ? t("输入下一问(排队,当前轮结束自动发送)") : t("发消息(Enter 发送,Shift+Enter 换行)")}
          disabled={ss.phase !== "ready"}
          onChange={(e) => ss.setDraft(e.target.value)}
          onInput={(e) => autoResize(e.currentTarget)}
          onKeyDown={(e) => {
            /* confirm 在卡:Esc 拒绝;Enter 不再批准(打字误敲是最高频误批准源),
               批准经卡内按钮;composing 让路输入法 */
            if (ss.confirm && !e.nativeEvent.isComposing && e.key === "Escape") {
              e.preventDefault();
              ss.answerConfirm(false);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ss.send();
            }
          }}
        />
        <button type="button" className="ss-send" disabled={ss.phase !== "ready" || !ss.draft.trim()} onClick={ss.send}>
          {t("发送")}
        </button>
      </div>
    </div>
  );
}
