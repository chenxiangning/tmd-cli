/**
 * 文件历史 / Git Blame 中央视视图 —— 详情页右键「Git 操作 ▸」入口的呈现面。
 * tab 契约(openTab/kind/payload)在 fileHistoryTab.ts;每次挂载即拉
 * (同 DiffTab:幕布随时改盘,重开即新鲜),token 防 cwd/切 tab 竞态。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { ipc, type GitBlameLine, type GitFileLogEntry } from "@kernel/ipc";
import { formatAbsolute } from "@kernel/relativeTime";
import { openCommitDiffTab } from "./commitTab";
import { gitErrorDisplay } from "./gitError";
import { readPayload, type FileHistoryTabPayload } from "./fileHistoryTab";

/* ── tab 内容组件(kind 路由由插件注册保证)────────────────── */

function CenterNote({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center p-6 text-xs text-(--tmd-fg-muted)">{text}</div>;
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center text-(--tmd-fg-muted)" role="status">
      <CircleNotch className="animate-spin" size="1rem" />
    </div>
  );
}

export function FileHistoryTabContent({ tab }: { tab: EditorTab }) {
  const payload = readPayload(tab.kind, tab.payload);
  if (!payload) return null;
  return <DataView key={`${payload.cwd}:${payload.path}`} payload={payload} blame={false} />;
}

export function GitBlameTabContent({ tab }: { tab: EditorTab }) {
  const payload = readPayload(tab.kind, tab.payload);
  if (!payload) return null;
  return <DataView key={`${payload.cwd}:${payload.path}`} payload={payload} blame />;
}

function DataView({ payload, blame }: { payload: FileHistoryTabPayload; blame: boolean }) {
  const [log, setLog] = useState<GitFileLogEntry[] | null>(null);
  const [lines, setLines] = useState<GitBlameLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const job = blame
      ? ipc.gitBlame(payload.cwd, payload.path).then((rows) => setLines(rows))
      : ipc.gitFileLog(payload.cwd, payload.path, 200).then((rows) => setLog(rows));
    job.catch((e) => {
      if (seq.current === mine) setError(gitErrorDisplay(e));
    });
    return () => {
      seq.current++;
    };
  }, [payload.cwd, payload.path, blame]);

  if (error) return <CenterNote text={error} />;
  if (blame) {
    if (!lines) return <Loading />;
    if (lines.length === 0) return <CenterNote text={t("文件为空,无归属行")} />;
    return (
      <div className="h-full overflow-auto font-mono text-xs leading-[1.5]">
        {lines.map((l) => (
          <div
            key={l.lineNo}
            className={`flex min-w-max ${l.boundary ? "border-t border-(--tmd-border)" : ""}`}
            title={`${l.shortSha} ${l.summary} · ${l.authorName}`}
          >
            <span className="sticky left-0 w-10 shrink-0 select-none bg-(--tmd-bg-elevated) pr-2 text-right text-(--tmd-fg-faint)">
              {l.lineNo}
            </span>
            {l.boundary && (
              <span className="shrink-0 border-r border-(--tmd-border) px-2 text-(--tmd-fg-muted)">
                {l.shortSha} {l.authorName} {formatAbsolute(l.authorWhen * 1000)}
              </span>
            )}
            <span className="whitespace-pre px-2">{l.text || " "}</span>
          </div>
        ))}
      </div>
    );
  }
  if (!log) return <Loading />;
  if (log.length === 0) return <CenterNote text={t("该文件暂无提交历史")} />;
  return (
    <div className="h-full overflow-y-auto">
      {log.map((e) => (
        <button
          key={e.longSha}
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover)"
          title={t("查看该提交的 diff")}
          onClick={() =>
            openCommitDiffTab({
              cwd: payload.cwd,
              sha: e.longSha,
              shortSha: e.shortSha,
              summary: e.summary,
              authorName: e.authorName,
              authorWhen: e.authorWhen,
              focusPath: payload.path,
            })
          }
        >
          <span className="shrink-0 font-mono text-(--tmd-fg-muted)">{e.shortSha}</span>
          <span className="min-w-0 flex-1 truncate">{e.summary}</span>
          <span className="shrink-0 text-(--tmd-fg-muted)">{e.authorName}</span>
          <time className="shrink-0 text-(--tmd-fg-faint)">{formatAbsolute(e.authorWhen * 1000)}</time>
        </button>
      ))}
    </div>
  );
}
