/**
 * CommitDiffTab —— 中央「提交 diff」tab(editorCenter.tabContent 挂载)。
 *
 * 一提交一 tab:头部提交摘要 + 左列文件清单(状态字母/±行数)+ 右侧 patch。
 * 与右栏 diff 视图完全独立:数据源是 commit_view(提交 vs 首父),
 * 不经 useGitDiffs(那是 index/worktree 语义)。
 * 非 git-commit-diff kind 的 tab 返回 null —— 每 kind 由各自插件渲染。
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useEditorTabs } from "@kernel/tabs";
import { formatAbsolute } from "@kernel/relativeTime";
import { ipc, type GitFilePatch } from "@kernel/ipc";
import { readCommitTabPayload, type CommitTabPayload } from "./commitTab";
import { useCommitFiles } from "./hooks/useCommitFiles";
import { gitErrorMessage } from "./gitError";
import { PatchLines } from "./views/PatchLines";
import { STATUS_COLOR } from "./views/statusColor";

export function CommitDiffTabContent() {
  const { activeId, tabs } = useEditorTabs();
  const active = tabs.find((t) => t.id === activeId);
  const payload = active ? readCommitTabPayload(active) : null;
  if (!active || !payload) return null;
  return <CommitDiffTab key={`${payload.cwd}:${payload.sha}`} payload={payload} />;
}

function CommitDiffTab({ payload }: { payload: CommitTabPayload }) {
  const { entries, ensure } = useCommitFiles(payload.cwd);
  useEffect(() => ensure(payload.sha), [ensure, payload.sha]);
  const entry = entries[payload.sha];
  const files = entry?.files ?? [];

  // 选中文件:优先 payload 深链;清单到位后失效选中回落到首个文件
  const [selected, setSelected] = useState<string | null>(payload.focusPath ?? null);
  useEffect(() => {
    setSelected(payload.focusPath ?? null);
  }, [payload.focusPath, payload.sha]);
  useEffect(() => {
    if (!entry || entry.loading) return;
    setSelected((prev) =>
      prev && entry.files.some((f) => f.path === prev) ? prev : (entry.files[0]?.path ?? null),
    );
  }, [entry]);

  /* patch 拉取:随 (cwd, sha, selected) 重拉;token 防 cwd/切文件竞态 */
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  const tokenRef = useRef(0);
  useEffect(() => {
    if (!selected) {
      setPatch(null);
      setPatchLoading(false);
      setPatchError(null);
      return;
    }
    const myToken = ++tokenRef.current;
    setPatchLoading(true);
    setPatchError(null);
    ipc.gitCommitFilePatch(payload.cwd, payload.sha, selected).then(
      (p) => {
        if (myToken !== tokenRef.current) return;
        setPatch(p);
        setPatchLoading(false);
      },
      (e: unknown) => {
        if (myToken !== tokenRef.current) return;
        setPatchError(gitErrorMessage(e));
        setPatchLoading(false);
      },
    );
  }, [payload.cwd, payload.sha, selected]);

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      {/* 提交头 */}
      <div className="shrink-0 border-b border-(--tmd-border) px-3 py-2">
        <div className="truncate font-medium text-(--tmd-fg)" title={payload.summary}>
          {payload.summary || "(空消息)"}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-(--tmd-fg-muted)">
          <span className="font-mono text-(--tmd-accent)">{payload.shortSha}</span>
          {payload.authorName && <span>{payload.authorName}</span>}
          {payload.authorWhen > 0 && <span>{formatAbsolute(payload.authorWhen * 1000)}</span>}
          <span className="flex-1" />
          {entry && !entry.loading && (
            <span className="tabular-nums text-(--tmd-fg-faint)">{files.length} 文件</span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 文件清单 */}
        <div className="w-60 shrink-0 overflow-y-auto border-r border-(--tmd-border)">
          {entry?.loading && (
            <div className="flex items-center justify-center gap-1.5 py-3 text-(--tmd-fg-faint)">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载中…
            </div>
          )}
          {entry?.error && (
            <div className="px-2 py-2 text-(--tmd-diff-removed)">{gitErrorShort(entry.error)}</div>
          )}
          {files.map((f) => {
            const name = f.path.split("/").pop() ?? f.path;
            const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
            const activeFile = f.path === selected;
            return (
              <button
                key={`${f.status}:${f.oldPath ?? ""}:${f.path}`}
                type="button"
                onClick={() => setSelected(f.path)}
                title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                className={`flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-(--tmd-bg-hover) ${
                  activeFile ? "bg-(--tmd-bg-active)" : ""
                }`}
              >
                <span
                  className={`w-3 shrink-0 text-center font-semibold ${STATUS_COLOR[f.status] ?? ""}`}
                >
                  {f.status}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{name}</span>
                  {dir && <span className="ml-1 text-[10px] text-(--tmd-fg-faint)">{dir}</span>}
                </span>
                {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                  <span className="shrink-0 tabular-nums text-[10px] text-(--tmd-fg-faint)">
                    <span className="text-(--tmd-diff-inserted)">+{f.additions}</span>{" "}
                    <span className="text-(--tmd-diff-removed)">-{f.deletions}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* patch 区 */}
        <div className="min-w-0 flex-1 overflow-auto">
          {patchLoading ? (
            <div className="flex items-center justify-center gap-1.5 py-6 text-(--tmd-fg-faint)">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载 diff…
            </div>
          ) : patchError ? (
            <div className="px-3 py-3 text-(--tmd-diff-removed)">{gitErrorShort(patchError)}</div>
          ) : patch?.binary ? (
            <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">二进制文件,无文本 diff</div>
          ) : patch ? (
            <PatchLines text={patch.patch} className="h-max min-h-full" />
          ) : selected ? (
            <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">无 patch 数据</div>
          ) : (
            <div className="flex h-full items-center justify-center text-(--tmd-fg-faint)">
              选择左侧文件查看 diff
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** tab 内错误只留正文(去 E_XXX: 前缀,右栏同款处理)。 */
function gitErrorShort(message: string): string {
  return message.replace(/^E_[A-Z_]+:\s*/, "");
}
