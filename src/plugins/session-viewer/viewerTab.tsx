/**
 * 会话查看 tab 内容 —— payload 深链 → profile.readSessionTranscript 只读快照。
 * 活会话手动刷新重读(不做文件 watch:查看频率低,YAGNI);长会话分批渲染
 * (首屏 200 块,滚动触底递增);md 预览管线(react-markdown)按需拆包
 * (files 插件同款纪律)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, lazy } from "react";
import type { EditorTab } from "@kernel/tabs";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import { pickSavePath } from "@kernel/ipc";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { formatRelativeTime } from "@kernel/relativeTime";
import type { SessionViewTabPayload } from "@kernel/sessionViewTabs";
import type { CliSessionTranscript } from "@kernel/cli";
import { TranscriptView } from "./transcriptView";
import { findBlockIndex } from "./locate";
import { sessionExportFileName, type MarkdownExport } from "./blocksToMarkdown";
import { exportReasonLabel, snapshotMdTo, type ExportSessionTarget } from "./exportMd";
import { ArrowsClockwiseIcon, Chats, DownloadSimpleIcon } from "@phosphor-icons/react";
import { Empty } from "@kernel/Empty";
import { Spinner } from "@kernel/Spinner";
import { retryImport } from "@kernel/lazyImport";

import "./session-viewer.css";
/* md 渲染管线体积大,按需拆包:首个 assistant 块出现才加载。 */
const MarkdownBody = lazy(retryImport(() =>
  import("./markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/** 首屏/增量批次(块级;工具卡与 md 块自身还有行级截断,见 transcriptView)。 */
const RENDER_BATCH = 200;

/** 导出完成 toast:有跳过(思考/图片)才带括注。 */
function exportedToast(out: MarkdownExport): string {
  const parts: string[] = [];
  if (out.skippedThinking > 0) parts.push(t("思考 {n}", { n: out.skippedThinking }));
  if (out.skippedImages > 0) parts.push(t("图片 {n}", { n: out.skippedImages }));
  return parts.length > 0
    ? t("已导出 {n} 块(跳过 {d})", { n: out.blocks, d: parts.join("/") })
    : t("已导出 {n} 块", { n: out.blocks });
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ok"; transcript: CliSessionTranscript };

export function SessionViewerTab({ tab }: { tab: EditorTab }) {
  const payload = tab.payload as SessionViewTabPayload;
  const { settings } = useSettingsState();
  const minimal = settings.sessionViewerMinimal;
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [visible, setVisible] = useState(RENDER_BATCH);
  const [nonce, setNonce] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /* 轻反馈 toast(本面板局部,PluginMarketPage 同款模式;仓内无全局 toast 体系)。 */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);
  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  /* 导出:pickSavePath → exportMd 内核 snapshotMdTo(重读磁盘快照 → 原子写)→
   * toast;取消/桩态静默。活会话导「当刻已落盘部分」,与查看态可能差新轮次,
   * 语义即「快照」(候选14)。 */
  const exportMd = useCallback(() => {
    if (state.phase !== "ok" || state.transcript.blocks.length === 0) return;
    const target: ExportSessionTarget = {
      cliSessionId: payload.cliSessionId,
      title: payload.title,
      profileId: payload.profileId,
      path: payload.path,
      modifiedAt: payload.modifiedAt ?? undefined,
      cwd: payload.cwd,
    };
    const name = sessionExportFileName(payload.title, payload.cliSessionId);
    void pickSavePath(t("导出会话转录"), name)
      .then((path) => {
        if (!path) return; /* 用户取消/web 桩态:静默 */
        void snapshotMdTo(path, target).then(
          (r) =>
            showToast(
              r.ok
                ? exportedToast(r.out)
                : t("导出转录快照失败:{reason}", { reason: exportReasonLabel(r.reason) }),
            ),
          (e) => showToast(e instanceof Error ? e.message : String(e)),
        );
      })
      .catch((e: unknown) => showToast(e instanceof Error ? e.message : String(e))); /* 对话框 IPC 失败不静默 */
  }, [state, payload.title, payload.cliSessionId, payload.profileId, payload.path, payload.modifiedAt, payload.cwd]);

  const profile = useMemo(
    () => host.getCliProfiles().find((p) => p.id === payload.profileId),
    [payload.profileId],
  );

  const load = useCallback(() => {
    setState({ phase: "loading" });
    setVisible(RENDER_BATCH);
    if (!profile?.readSessionTranscript) {
      setState({ phase: "error", message: t("该引擎暂不支持转录解析") });
      return;
    }
    const reader = profile.readSessionTranscript;
    /* 活会话行无磁盘 path:经 listSessions(cwd) 兜底定位同 id 会话(一次性
     *  扫描,查看动作触发,无轮询)。 */
    const resolve = async () => {
      if (payload.path) {
        return reader({
          id: payload.cliSessionId,
          title: payload.title,
          modifiedAt: payload.modifiedAt ?? Date.now(),
          path: payload.path,
        });
      }
      if (!payload.cwd || !profile.listSessions) return null;
      const sessions = await profile.listSessions(payload.cwd).catch(() => null);
      const hit = sessions?.find((s) => s.id === payload.cliSessionId);
      return hit ? reader(hit) : null;
    };
    resolve()
      .then((transcript) => {
        if (!transcript) {
          setState({ phase: "error", message: t("读取会话转录失败") });
          return;
        }
        setState({ phase: "ok", transcript });
      })
      .catch(() => setState({ phase: "error", message: t("读取会话转录失败") }));
  }, [profile, payload.cliSessionId, payload.title, payload.modifiedAt, payload.path, payload.cwd]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  /* 深链定位(批一追加):payload.locate → user 块下标纯派生,不进 effect
     回写状态;越出已渲染批次由切片帽扩大覆盖,块 DOM 出现后滚一次(ref 防重放)。 */
  const locateIdx = useMemo(() => {
    if (!payload.locate || state.phase !== "ok") return null;
    return findBlockIndex(state.transcript.blocks, payload.locate.text, payload.locate.occurrence ?? 1);
  }, [payload.locate, state]);
  const locateId = locateIdx !== null && state.phase === "ok" ? state.transcript.blocks[locateIdx].id : null;
  const locatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (locateId === null || locatedRef.current === locateId) return;
    const el = scrollRef.current?.querySelector(`[data-vb="${CSS.escape(locateId)}"]`);
    if (!el) return; /* 分批未及:cap 扩大重渲染后本 effect 随 visible/state 重跑 */
    locatedRef.current = locateId;
    el.scrollIntoView({ block: "center" });
  }, [locateId, visible, state]);

  /* 滚动触底递增批次(无虚拟滚动:块级截断 + 分批已控 DOM 规模)。 */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || state.phase !== "ok") return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      setVisible((v) => (v < state.transcript.blocks.length ? v + RENDER_BATCH : v));
    }
  }, [state]);


  /* 分批切片记忆化:blocks 引用稳定 → TranscriptView 内 items 与块级 memo
     在无关重渲染(滚动探测/加载态翻转)时命中,不全量重建。
     定位目标越出已渲染批次时扩大帽(不回写 visible 状态)。 */
  const shown = useMemo(
    () => (state.phase === "ok" ? state.transcript.blocks.slice(0, Math.max(visible, (locateIdx ?? -1) + 1)) : []),
    [state, visible, locateIdx],
  );
  return (
    <div className="sv-root" data-icon-decor="session-view">
      <ViewerHeader
        payload={payload}
        profile={profile}
        phase={state.phase}
        truncated={state.phase === "ok" ? state.transcript.truncated : false}        minimal={minimal}
        exportDisabled={state.phase !== "ok" || (state.phase === "ok" && state.transcript.blocks.length === 0)}
        onToggleMinimal={() => updateSettings({ sessionViewerMinimal: !minimal })}
        onExport={exportMd}
        onRefresh={() => setNonce((n) => n + 1)}
      />
      <div className="sv-scroll" ref={scrollRef} onScroll={onScroll}>
        {state.phase === "loading" ? (
          <div className="sv-empty">
            {/* 忙态统一 Spinner 原语(域内词条「读取中…」) */}
            <span className="inline-flex items-center gap-2">
              <Spinner />
              {t("读取中…")}
            </span>
          </div>
        ) : null}
        {state.phase === "error" ? (
          <div className="sv-empty" role="alert">
            <span className="text-(--tmd-err)">{state.message}</span>
          </div>
        ) : null}
        {state.phase === "ok" ? (
          state.transcript.blocks.length === 0 ? (
            <div className="sv-empty">
              <Empty icon={<Chats />}>{t("会话没有可解析的对话内容")}</Empty>
            </div>
          ) : (
            <div className="sv-blocks">
              <TranscriptView
                blocks={shown}
                Markdown={MarkdownBody}
                minimal={minimal}
                locateId={locateId}
              />
              {visible < state.transcript.blocks.length ? (
                <button
                  type="button"
                  className="sv-more"
                  onClick={() => setVisible((v) => v + RENDER_BATCH)}
                >
                  {t("加载更多")}
                </button>
              ) : null}
            </div>
          )
        ) : null}
      </div>
      {toast ? <div className="sv-toast" role="status">{toast}</div> : null}
    </div>
  );
}

/** 头部条:引擎图标/标题/相对时间/截断标注 + 极简、导出、刷新三钮(复杂度摊平拆件)。 */
function ViewerHeader({
  payload,
  profile,
  phase,
  truncated,
  minimal,
  exportDisabled,
  onToggleMinimal,
  onExport,
  onRefresh,
}: {
  payload: SessionViewTabPayload;
  profile: ReturnType<typeof host.getCliProfiles>[number] | undefined;
  phase: LoadState["phase"];
  truncated: boolean | undefined;
  minimal: boolean;
  exportDisabled: boolean;
  onToggleMinimal: () => void;
  onExport: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="sv-header">
      {profile?.renderIcon ? <span className="sv-engine-icon">{profile.renderIcon("0.875rem")}</span> : null}
      <span className="sv-title">{payload.title || payload.cliSessionId.slice(0, 8)}</span>
      <span className="sv-engine-name">{profile?.name ?? payload.profileId}</span>
      {payload.modifiedAt ? (
        <span className="sv-time">{formatRelativeTime(payload.modifiedAt)}</span>
      ) : null}
      {phase === "ok" && truncated ? (
        <span className="sv-truncated">{t("会话过大,已截断")}</span>
      ) : null}
      <button
        type="button"
        className={`sv-minimal${minimal ? " is-on" : ""}`}
        aria-pressed={minimal}
        title={t("极简展示:每轮工作过程折叠为一行,只保留最终答复")}
        onClick={onToggleMinimal}
      >
        {t("极简")}
      </button>
      <button
        type="button"
        className="sv-export"
        title={t("导出 Markdown")}
        disabled={exportDisabled}
        onClick={onExport}
      >
        <DownloadSimpleIcon size="0.875rem" />
      </button>
      <button type="button" className="sv-refresh" title={t("刷新")} onClick={onRefresh}>
        <ArrowsClockwiseIcon size="0.875rem" />
      </button>
    </header>
  );
}
