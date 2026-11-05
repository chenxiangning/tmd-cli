/**
 * 结构化会话 tab 内容 —— RPC 驱动(omp/pi `--mode rpc`),token 级流式转录 +
 * 自带输入面(能力见 ssComposer) + 审批回路。数据链:PiRpcSession(cli-shared)
 * ← kernel proc_stream 通用原语;PTY 零涉及。落定历史走 SsTurnView(codemoss
 * 逐轮形态),活轮走 LiveTurn;关闭 tab = kill 子进程(useEffect 收割)。
 * 生命周期编排见 ssSession.ts。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { lazy, useEffect, useRef, useState } from "react";
import { ArrowDown } from "@phosphor-icons/react";
import { getActiveTabId, updateTab, type EditorTab } from "@kernel/tabs";
import { getStructuredSessionRows, noteStructuredSessionRow } from "@kernel/structuredSessionTabs";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { useSettingsState } from "@kernel/settings";
import { retryImport } from "@kernel/lazyImport";
import { SsHeader } from "./ssHeader";
import { SsActions } from "./ssActions";
import { SsTurnView } from "./ssTurnView";
import { LiveTurn } from "./liveTurn";
import { liveFromIndex } from "./ssLiveFrom";
import { useSettleKey } from "./ssSettleKey";
import { useCanvasWidth } from "./ssCanvasResize";
import { SsComposer } from "./ssComposer";
import { useSsSession, type Phase } from "./ssSession";
import type { StructuredSessionPayload } from "@kernel/structuredSessionTabs";
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
  /* 回底悬浮钮:尾部位移 >100px(codemoss AWAY_THRESHOLD)时浮出,点击滑回底部
   * 并恢复贴底跟随;贴底/短内容隐藏。 */
  const [away, setAway] = useState(false);
  /* 结算换装 key(刚落定轮首块 id)与活轮起点(用户轮界律);引擎轮界帧在
   * 多步循环逐步推进,turnStart 不可作渲染界,见 liveFromIndex 头注。 */
  const settleKey = useSettleKey(ss.turnLive, ss.blocks);
  const liveFrom = liveFromIndex(ss.blocks, ss.turnStart, ss.turnLive);
  /* 幕布宽度:默认 85%,左右抓手对称拖调(居中锚),松手落 localStorage。 */
  const canvas = useCanvasWidth();

  /* 贴底跟随(busy 流式期),上翻停跟。 */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && ss.stickRef.current) el.scrollTop = el.scrollHeight;
  }, [ss.blocks, ss.stickRef]);

  /* 左栏行投影广播(RPC 会话体系对齐批次 1):运行态变化即 note,kernel 行集
   * 随 tab 生命周期自动增删,本组件无需清理。 */
  useEffect(() => {
    noteStructuredSessionRow(tab.id, {
      phase: ss.phase,
      busy: ss.busy,
      busySince: ss.busySince,
      waitingConfirm: ss.confirm != null,
      sessionId: ss.sessionId,
    });
  }, [tab.id, ss.phase, ss.busy, ss.busySince, ss.confirm, ss.sessionId]);

  /* 未读记账(批次 2):busy true→false 沿 = 一轮结算;tab 非激活时累加未读
   * (激活即读由 kernel 订阅 setActiveTab 出口清零,此处只管涨)。 */
  const prevBusyRef = useRef(false);
  useEffect(() => {
    const settledEdge = prevBusyRef.current && !ss.busy;
    prevBusyRef.current = ss.busy;
    if (!settledEdge) return;
    const active = getActiveTabId() === tab.id;
    const unread = (getStructuredSessionRows().find((r) => r.tabId === tab.id)?.unread ?? 0) + 1;
    noteStructuredSessionRow(tab.id, { unread: active ? 0 : unread });
  }, [ss.busy, tab.id]);

  /* 标题自动化:首个用户块摘要(PTY 磁盘标题同语义的会话主题锚定),中央 tab
   * 条与左栏行同步;纯图片块(空文本)不触发。 */
  const firstUserText = ss.blocks.find((b) => b.role === "user")?.text.trim();
  useEffect(() => {
    if (firstUserText) updateTab(tab.id, { title: firstUserText.slice(0, 32) });
  }, [firstUserText, tab.id]);


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
          if (!el) return;
          const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
          ss.stickRef.current = nearBottom;
          setAway(!nearBottom && el.scrollHeight - el.clientHeight > 100);
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
          <>
            {/* 宽度抓手:sticky 贴滚动视口垂直居中,横向 margin 随列宽收窄(列缘内 4px) */}
            <div
              className="ss-canvas-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("调整幕布宽度")}
              title={t("调整幕布宽度")}
              style={{ marginLeft: `calc(${(100 - canvas.widthPct) / 2}% - 4px)` }}
              onPointerDown={canvas.onHandleDown}
            />
            <div
              className="ss-canvas-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("调整幕布宽度")}
              title={t("调整幕布宽度")}
              style={{ marginLeft: `calc(${(100 + canvas.widthPct) / 2}% - 4px)` }}
              onPointerDown={canvas.onHandleDown}
            />
            <div className="ss-blocks" style={{ width: `${canvas.widthPct}%` }}>
              {/* 落定历史:codemoss 形态逐轮渲染(用户 → 过程折叠组 → 答复);
                  活轮起点 liveFrom 之前归落定,本轮块全程活轮展开 */}
              {liveFrom > 0 ? (
                <SsTurnView blocks={ss.blocks.slice(0, liveFrom)} Markdown={MarkdownBody} settleKey={settleKey} />
              ) : null}
              <LiveTurn blocks={ss.blocks.slice(liveFrom)} live={ss.turnLive} Markdown={MarkdownBody} thinkingLabel={t("思考中…")} liveSurface={ss.liveSurface} />
            </div>
          </>
        ) : null}
        {away ? (
          <button
            type="button"
            className="ss-scrollbtn"
            title={t("回到底部")}
            aria-label={t("回到底部")}
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              ss.stickRef.current = true;
              el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
              setAway(false);
            }}
          >
            <ArrowDown size="0.875rem" />
          </button>
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
