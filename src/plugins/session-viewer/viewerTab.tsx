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
import { formatRelativeTime } from "@kernel/relativeTime";
import type { SessionViewTabPayload } from "@kernel/sessionViewTabs";
import type { CliSessionTranscript } from "@kernel/cli";
import { TranscriptView } from "./transcriptView";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { retryImport } from "@kernel/lazyImport";

import "./session-viewer.css";
/* md 渲染管线体积大,按需拆包:首个 assistant 块出现才加载。 */
const MarkdownBody = lazy(retryImport(() =>
  import("./markdownBody").then((m) => ({ default: m.MarkdownBody })),
));

/** 首屏/增量批次(块级;工具卡与 md 块自身还有行级截断,见 transcriptView)。 */
const RENDER_BATCH = 200;

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ok"; transcript: CliSessionTranscript };

export function SessionViewerTab({ tab }: { tab: EditorTab }) {
  const payload = tab.payload as SessionViewTabPayload;
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [visible, setVisible] = useState(RENDER_BATCH);
  const [nonce, setNonce] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  /* 滚动触底递增批次(无虚拟滚动:块级截断 + 分批已控 DOM 规模)。 */
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || state.phase !== "ok") return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      setVisible((v) => (v < state.transcript.blocks.length ? v + RENDER_BATCH : v));
    }
  }, [state]);


  /* 分批切片记忆化:blocks 引用稳定 → TranscriptView 内 items 与块级 memo
     在无关重渲染(滚动探测/加载态翻转)时命中,不全量重建。 */
  const shown = useMemo(
    () => (state.phase === "ok" ? state.transcript.blocks.slice(0, visible) : []),
    [state, visible],
  );
  return (
    <div className="sv-root">
      <header className="sv-header">
        {profile?.renderIcon ? <span className="sv-engine-icon">{profile.renderIcon("0.875rem")}</span> : null}
        <span className="sv-title">{payload.title || payload.cliSessionId.slice(0, 8)}</span>
        <span className="sv-engine-name">{profile?.name ?? payload.profileId}</span>
        {payload.modifiedAt ? (
          <span className="sv-time">{formatRelativeTime(payload.modifiedAt)}</span>
        ) : null}
        {state.phase === "ok" && state.transcript.truncated ? (
          <span className="sv-truncated">{t("会话过大,已截断")}</span>
        ) : null}
        <button
          type="button"
          className="sv-refresh"
          title={t("刷新")}
          onClick={() => setNonce((n) => n + 1)}
        >
          <ArrowsClockwiseIcon size="0.875rem" />
        </button>
      </header>
      <div className="sv-scroll" ref={scrollRef} onScroll={onScroll}>
        {state.phase === "loading" ? <div className="sv-empty">{t("读取中…")}</div> : null}
        {state.phase === "error" ? <div className="sv-empty">{state.message}</div> : null}
        {state.phase === "ok" ? (
          state.transcript.blocks.length === 0 ? (
            <div className="sv-empty">{t("会话没有可解析的对话内容")}</div>
          ) : (
            <div className="sv-blocks">
              <TranscriptView
                blocks={shown}
                Markdown={MarkdownBody}
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
    </div>
  );
}
