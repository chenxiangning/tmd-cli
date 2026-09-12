/**
 * CommitDiffTab —— 中央「提交 diff」tab(editorCenter.tabContent 挂载)。
 *
 * 一提交一 tab:头部提交摘要 + 左列文件清单(状态字母/±行数)+ 右侧 patch。
 * 与右栏 diff 视图完全独立:数据源是 commit_view(提交 vs 首父),
 * 不经 useGitDiffs(那是 index/worktree 语义)。
 * kind 路由由 kernel/tabs 注册表保证,本组件只见 git-commit-diff tab。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch } from "@phosphor-icons/react";
import type { EditorTab } from "@kernel/tabs";
import { formatAbsolute } from "@kernel/relativeTime";
import { ipc, type GitCommitFile, type GitFilePatch } from "@kernel/ipc";
import type { GitDiffMode } from "@kernel/settings";
import { readCommitTabPayload, type CommitTabPayload } from "./commitTab";
import { useCommitFiles } from "./hooks/useCommitFiles";
import { gitErrorMessage } from "./gitError";
import { PatchLines } from "./views/PatchLines";
import { DiffModeToggle } from "./views/DiffModeToggle";
import { STATUS_COLOR } from "./views/statusColor";
import { useGitPanelState } from "./panelStore";

export function CommitDiffTabContent({ tab }: { tab: EditorTab }) {
  const payload = readCommitTabPayload(tab);
  if (!payload) return null;
  return <CommitDiffTab key={`${payload.cwd}:${payload.sha}`} payload={payload} />;
}

function CommitDiffTab({ payload }: { payload: CommitTabPayload }) {
  const { entries, ensure } = useCommitFiles(payload.cwd);
  useEffect(() => ensure(payload.sha), [ensure, payload.sha]);
  const { diffMode } = useGitPanelState();
  const entry = entries[payload.sha];
  const files = entry?.files ?? [];

  /* 选中文件:用户点选 ?? payload 深链;sha/focusPath 变化作废旧点选(带 key 比对),
     清单到位后选中失效(文件没了)渲染期直接回落首个文件 —— 全部派生,无同步 effect。 */
  const selKey = `${payload.sha}:${payload.focusPath ?? ""}`;
  const [picked, setPicked] = useState<{ key: string; path: string } | null>(null);
  const requested = picked && picked.key === selKey ? picked.path : (payload.focusPath ?? null);
  const selected =
    !entry || entry.loading
      ? requested
      : requested && entry.files.some((f) => f.path === requested)
        ? requested
        : (entry.files[0]?.path ?? null);

  /* patch 拉取:随 (cwd, sha, selected) 重拉;token 防 cwd/切文件竞态 */
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchError, setPatchError] = useState<string | null>(null);
  /* 全文查看:per-tab 本地态,默认关;切文件即复位(见文件行 onClick)。 */
  const [fullView, setFullView] = useState(false);
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
    ipc.gitCommitFilePatch(payload.cwd, payload.sha, selected, fullView).then(
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
  }, [payload.cwd, payload.sha, selected, fullView]);

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      {/* 提交头 */}
      <CommitDiffHeader
        payload={payload}
        entry={entry}
        fileCount={files.length}
        fullView={fullView}
        onToggleFullView={() => setFullView((v) => !v)}
      />

      <div className="flex min-h-0 flex-1">
        <CommitFileList
          entry={entry}
          files={files}
          selected={selected}
          onPick={(path) => {
            setPicked({ key: selKey, path });
            setFullView(false); /* 全文查看只管当前文件,下个文件重新开 */
          }}
        />
        <CommitPatchPane
          patchLoading={patchLoading}
          patchError={patchError}
          patch={patch}
          selected={selected}
          diffMode={diffMode}
        />
      </div>
    </div>
  );
}

/** 提交头:摘要 + sha/作者/时间 + 文件数 + 视图切换(自主组件拆出降复杂度)。 */
function CommitDiffHeader({
  payload,
  entry,
  fileCount,
  fullView,
  onToggleFullView,
}: {
  payload: CommitTabPayload;
  entry: { files: GitCommitFile[]; loading: boolean; error: string | null } | undefined;
  fileCount: number;
  fullView: boolean;
  onToggleFullView: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-(--tmd-border) px-3 py-2">
      <div className="truncate font-medium text-(--tmd-fg)" title={payload.summary}>
        {payload.summary || t("(空消息)")}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-(--tmd-fg-muted)">
        <span className="font-mono text-(--tmd-accent)">{payload.shortSha}</span>
        {payload.authorName && <span>{payload.authorName}</span>}
        {payload.authorWhen > 0 && <span>{formatAbsolute(payload.authorWhen * 1000)}</span>}
        <span className="flex-1" />
        {entry && !entry.loading && (
          <span className="tabular-nums text-(--tmd-fg-faint)">{t("{n} 文件", { n: fileCount })}</span>
        )}
        <DiffModeToggle fullView={fullView} onToggleFullView={onToggleFullView} />
      </div>
    </div>
  );
}

/** 左列文件清单:状态字母 + 文件名/目录 + ±行数。 */
function CommitFileList({
  entry,
  files,
  selected,
  onPick,
}: {
  entry: { files: GitCommitFile[]; loading: boolean; error: string | null } | undefined;
  files: GitCommitFile[];
  selected: string | null;
  onPick: (path: string) => void;
}) {
  return (
    <div className="w-60 shrink-0 overflow-y-auto border-r border-(--tmd-border)">
      {entry?.loading && (
        <div className="flex items-center justify-center gap-1.5 py-3 text-(--tmd-fg-faint)">
          <CircleNotch className="h-[0.75rem] w-[0.75rem] animate-spin" /> {t("加载中…")}
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
            onClick={() => onPick(f.path)}
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
              {dir && <span className="ml-1 text-[0.625rem] text-(--tmd-fg-faint)">{dir}</span>}
            </span>
            {!f.binary && (f.additions > 0 || f.deletions > 0) && (
              <span className="shrink-0 tabular-nums text-[0.625rem] text-(--tmd-fg-faint)">
                <span className="text-(--tmd-diff-inserted)">+{f.additions}</span>{" "}
                <span className="text-(--tmd-diff-removed)">-{f.deletions}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 右侧 patch 区:加载/错误/二进制/空各有文案。 */
function CommitPatchPane({
  patchLoading,
  patchError,
  patch,
  selected,
  diffMode,
}: {
  patchLoading: boolean;
  patchError: string | null;
  patch: GitFilePatch | null;
  selected: string | null;
  diffMode: GitDiffMode;
}) {
  return (
    <div className="min-w-0 flex-1 overflow-auto">
      {patchLoading ? (
        <div className="flex items-center justify-center gap-1.5 py-6 text-(--tmd-fg-faint)">
          <CircleNotch className="h-[0.875rem] w-[0.875rem] animate-spin" /> {t("加载 diff…")}
        </div>
      ) : patchError ? (
        <div className="px-3 py-3 text-(--tmd-diff-removed)">{gitErrorShort(patchError)}</div>
      ) : patch?.binary ? (
        <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">{t("二进制文件,无文本 diff")}</div>
      ) : patch ? (
        <PatchLines text={patch.patch} className="h-max min-h-full" mode={diffMode} />
      ) : selected ? (
        <div className="px-3 py-6 text-center text-(--tmd-fg-faint)">{t("无 patch 数据")}</div>
      ) : (
        <div className="flex h-full items-center justify-center text-(--tmd-fg-faint)">
          {t("选择左侧文件查看 diff")}
        </div>
      )}
    </div>
  );
}
/** tab 内错误只留正文(去 E_XXX: 前缀,右栏同款处理)。 */
function gitErrorShort(message: string): string {
  return message.replace(/^E_[A-Z_]+:\s*/, "");
}
