/**
 * 文件历史中央 tab 视图 —— 详情页右键「Git 操作 ▸ 显示文件历史」入口的呈现面。
 * (Git Blame 不走 tab:经 kernel/cmEditor/editorBlame 内嵌进文件详情编辑器。)
 * 提交行点击经既有 commitTab 打开该提交 diff(focusPath 定位本文件);
 * 每次挂载即拉(同 DiffTab:幕布随时改盘,重开即新鲜),token 防竞态。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { ipc, type GitFileLogEntry } from "@kernel/ipc";
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
  return <HistoryList key={`${payload.cwd}:${payload.path}`} payload={payload} />;
}

function HistoryList({ payload }: { payload: FileHistoryTabPayload }) {
  const [log, setLog] = useState<GitFileLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    ipc
      .gitFileLog(payload.cwd, payload.path, 200)
      .then((rows) => setLog(rows))
      .catch((e) => {
        if (seq.current === mine) setError(gitErrorDisplay(e));
      });
    return () => {
      seq.current++;
    };
  }, [payload.cwd, payload.path]);

  if (error) return <CenterNote text={error} />;
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
