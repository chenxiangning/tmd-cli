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
import { Spinner } from "@kernel/Spinner";
import type { EditorTab } from "@kernel/tabs";
import { formatAbsolute } from "@kernel/relativeTime";
import { ipc, type GitCommitFile, type GitFilePatch } from "@kernel/ipc";
import { readCommitTabPayload, type CommitTabPayload } from "./commitTab";
import { useCommitFiles } from "./hooks/useCommitFiles";
import { gitErrorDisplay, gitErrorMessage } from "./gitError";
import { host } from "@kernel/host";
import { add, sessionKeyOf, useDiffNotesStore } from "./diffNotes";
import type { PatchNoteCtx } from "./views/PatchLines";
import { DiffNotesPanel } from "./views/DiffNotesPanel";
import { DiffPatchPane } from "./views/DiffPatchPane";
import { DiffModeToggle } from "./views/DiffModeToggle";
import { countFoldRuns } from "./views/patchModel";
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
  /* 全文查看:per-tab 本地态,默认关;切文件即复位(见文件行 onClick)。
     expandFolds:折叠段展开入口在头部工具条;同随切文件复位。 */
  const [fullView, setFullView] = useState(false);
  const [expandFolds, setExpandFolds] = useState(false);
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

  /* 行级批注:会话键 = 批注时刻激活会话快照(add 时取),面板按当前键隔离展示。 */
  const store = useDiffNotesStore();
  const sessionKey = sessionKeyOf(host.getActiveSessionId(), payload.cwd);
  const noteCtx: PatchNoteCtx | null = selected
    ? {
        file: selected,
        notes: store.groups[sessionKey]?.filter((n) => n.file === selected) ?? [],
        onAdd: (hash, lineNo, text, excerpt) => {
          add(sessionKey, selected, hash, lineNo, text, excerpt);
        },
      }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs" data-icon-decor="git-zone">
      {/* 提交头 */}
      <CommitDiffHeader
        payload={payload}
        entry={entry}
        fileCount={files.length}
        fullView={fullView}
        onToggleFullView={() => {
          setFullView((v) => !v);
          setExpandFolds(false);
        }}
        folds={fullView && patch ? countFoldRuns(patch.patch, diffMode === "split") > 0 : false}
        expandFolds={expandFolds}
        onToggleFolds={() => setExpandFolds((v) => !v)}
      />

      <div className="flex min-h-0 flex-1">
        <CommitFileList
          entry={entry}
          files={files}
          selected={selected}
          onPick={(path) => {
            setPicked({ key: selKey, path });
            setFullView(false); /* 全文查看只管当前文件,下个文件重新开 */
            setExpandFolds(false);
          }}
        />
        <div className="flex min-h-0 flex-1 flex-col">
          <DiffPatchPane
            patchLoading={patchLoading}
            patchError={patchError}
            patch={patch}
            selected={selected}
            diffMode={diffMode}
            fullView={fullView}
            expandFolds={expandFolds}
            emptyText={t("无 patch 数据")}
            noteCtx={noteCtx}
          />
          <DiffNotesPanel sessionKey={sessionKey} />
        </div>
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
  folds,
  expandFolds,
  onToggleFolds,
}: {
  payload: CommitTabPayload;
  entry: { files: GitCommitFile[]; loading: boolean; error: string | null } | undefined;
  fileCount: number;
  fullView: boolean;
  onToggleFullView: () => void;
  folds: boolean;
  expandFolds: boolean;
  onToggleFolds: () => void;
}) {
  return (
    <div className="shrink-0 border-b border-(--tmd-border) px-3 py-2">
      <div className="truncate font-medium text-(--tmd-fg)" title={payload.summary}>
        {payload.summary || t("(空消息)")}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-xs text-(--tmd-fg-muted)">
        <span className="font-mono text-(--tmd-accent)">{payload.shortSha}</span>
        {payload.authorName && <span>{payload.authorName}</span>}
        {payload.authorWhen > 0 && <span>{formatAbsolute(payload.authorWhen * 1000)}</span>}
        <span className="flex-1" />
        {entry && !entry.loading && (
          <span className="tabular-nums text-(--tmd-fg-faint)">{t("{n} 文件", { n: fileCount })}</span>
        )}
        <DiffModeToggle
          fullView={fullView}
          onToggleFullView={onToggleFullView}
          folds={folds}
          expandFolds={expandFolds}
          onToggleFolds={onToggleFolds}
        />
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
          <Spinner /> {t("加载中…")}
        </div>
      )}
      {entry?.error && (
        <div className="px-2 py-2 text-(--tmd-diff-removed)">{gitErrorDisplay(entry.error)}</div>
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
              {dir && <span className="ml-1 text-meta text-(--tmd-fg-faint)">{dir}</span>}
            </span>
            {!f.binary && (f.additions > 0 || f.deletions > 0) && (
              <span className="shrink-0 tabular-nums text-meta text-(--tmd-fg-faint)">
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
