/**
 * DiffView —— 差异视图(截图主体):聚合行 + 文件列表(树/平铺)+ patch 抽屉 + 提交 composer。
 *
 * checkbox = 纳入本次提交;提交 = 单次 gitCommit(cwd, checked, msg) 原子完成。
 * +/- 行内按钮 = 独立 stage/unstage 高级路径,与 checkbox 正交。
 */

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
} from "lucide-react";
import { ipc, type GitFilePatch, type GitFileStatus } from "@kernel/ipc";
import type { FileListLayout } from "../panelStore";
import type { GitPatchState } from "../hooks/useGitDiffs";
import { buildTree } from "./diffTree";
import { gitErrorDisplay } from "../gitError";
import { PatchLines } from "./PatchLines";
import { STATUS_COLOR } from "./statusColor";

interface Props {
  cwd: string;
  layout: FileListLayout;
  files: GitFileStatus[];
  diffs: GitPatchState;
  prefill: { message: string; seq: number } | null;
  onMutation: () => void;
}

export function DiffView({ cwd, layout, files, diffs, prefill, onMutation }: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  // 文件消失(已提交/还原)时同步掉勾选与展开
  useEffect(() => {
    const live = new Set(files.map((f) => f.path));
    setChecked((prev) => {
      const next = new Set([...prev].filter((p) => live.has(p)));
      return next.size === prev.size ? prev : next;
    });
    if (expandedPath && !live.has(expandedPath)) {
      setExpandedPath(null);
      diffs.select(null, false);
    }
  }, [files, expandedPath, diffs]);

  const toggleExpand = (f: GitFileStatus) => {
    if (expandedPath === f.path) {
      setExpandedPath(null);
      diffs.select(null, false);
    } else {
      setExpandedPath(f.path);
      // wt 优先:暂存后又改的复合文件,预览 worktree 侧(= 勾选提交的实际内容)
      diffs.select(f.path, f.staged && !f.wt);
    }
  };

  const toggleCheck = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const rows = useMemo(
    () => (layout === "tree" ? buildTree(files) : files.map((f) => ({ depth: 0, file: f }))),
    [files, layout],
  );

  return (
    <div className="flex h-full flex-col">
      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 && (
          <div className="flex h-24 items-center justify-center text-(--tmd-fg-faint)">
            工作区干净,无变更
          </div>
        )}
        {rows.map((row) =>
          "dir" in row ? (
            <div
              key={`dir:${row.dir}`}
              className="flex items-center gap-1 px-2 py-1 font-medium text-(--tmd-fg-muted)"
            >
              <ChevronDown className="h-3 w-3" />
              {row.dir}
            </div>
          ) : (
            <FileRow
              key={row.file.path}
              file={row.file}
              depth={row.depth}
              checked={checked.has(row.file.path)}
              expanded={expandedPath === row.file.path}
              patch={expandedPath === row.file.path ? diffs.patch : null}
              patchLoading={expandedPath === row.file.path && diffs.loading}
              onToggleCheck={() => toggleCheck(row.file.path)}
              onToggleExpand={() => toggleExpand(row.file)}
              onStage={() =>
                ipc
                  .gitStage(cwd, [row.file.path])
                  .then(onMutation, (e) => console.warn(gitErrorDisplay(e)))
              }
              onUnstage={() =>
                ipc
                  .gitUnstage(cwd, [row.file.path])
                  .then(onMutation, (e) => console.warn(gitErrorDisplay(e)))
              }
              onDiscard={() => {
                // 破坏性操作:confirm 前置(工作区还原到暂存区内容,staged 保留,untracked 不动)
                if (!window.confirm(`放弃 ${row.file.path} 的工作区改动?不可恢复。`)) return;
                ipc
                  .gitDiscard(cwd, [row.file.path])
                  .then(onMutation, (e) => console.warn(gitErrorDisplay(e)));
              }}
            />
          ),
        )}
      </div>

      <CommitComposer
        cwd={cwd}
        checked={checked}
        prefill={prefill}
        onCommitted={() => {
          setChecked(new Set());
          setExpandedPath(null);
          diffs.select(null, false);
          onMutation();
        }}
      />
    </div>
  );
}

/* ── 文件行 + 内联 patch 抽屉 ── */

function FileRow({
  file,
  depth,
  checked,
  expanded,
  patch,
  patchLoading,
  onToggleCheck,
  onToggleExpand,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
  depth: number;
  checked: boolean;
  expanded: boolean;
  patch: GitFilePatch | null;
  patchLoading: boolean;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const isConflict = file.status === "C";
  const displayStatus = file.status === "?" ? "U" : file.status;
  return (
    <div>
      <div
        className="group flex items-center gap-1.5 py-1 pr-2 hover:bg-(--tmd-bg-hover)"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleCheck}
          onClick={(e) => e.stopPropagation()}
          disabled={isConflict}
          title={isConflict ? "冲突文件:请到幕布终端解决后提交" : undefined}
          className="h-3 w-3 shrink-0 accent-(--tmd-accent) disabled:opacity-40"
        />
        <button
          onClick={onToggleExpand}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-(--tmd-fg-faint)" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-(--tmd-fg-faint)" />
          )}
          <FileText className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" />
          <span className="min-w-0 flex-1 truncate">{depth > 0 ? file.path.slice(file.path.indexOf("/") + 1) : file.path}</span>
          <span className={`font-mono text-[10px] ${STATUS_COLOR[file.status] ?? ""}`}>
            {displayStatus}
          </span>
        </button>
        {!isConflict && (
          <button
            onClick={file.staged ? onUnstage : onStage}
            title={file.staged ? "unstage" : "stage"}
            className="w-4 shrink-0 text-center opacity-0 hover:text-(--tmd-accent) group-hover:opacity-60"
          >
            {file.staged ? "−" : "+"}
          </button>
        )}
        {file.wt && !isConflict && (
          <button
            onClick={onDiscard}
            title="放弃工作区改动(还原到暂存区;已暂存内容保留)"
            className="w-4 shrink-0 text-center opacity-0 hover:text-(--tmd-diff-removed) group-hover:opacity-60"
          >
            ↺
          </button>
        )}
        {isConflict && (
          <span className="shrink-0 text-[10px] text-(--tmd-diff-removed)">冲突</span>
        )}
      </div>
      {expanded && (
        <div className="border-y border-(--tmd-border) bg-(--tmd-bg-sunken)">
          {patchLoading && (
            <div className="flex items-center gap-1.5 px-3 py-2 text-(--tmd-fg-faint)">
              <Loader2 className="h-3 w-3 animate-spin" /> 加载 diff…
            </div>
          )}
          {!patchLoading && patch?.binary && (
            <div className="px-3 py-2 text-(--tmd-fg-faint)">二进制文件</div>
          )}
          {!patchLoading && patch && !patch.binary && <PatchLines text={patch.patch} />}
          {!patchLoading && !patch && (
            <div className="px-3 py-2 text-(--tmd-fg-faint)">无 diff 数据</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 提交 composer(常驻底部)── */

function CommitComposer({
  cwd,
  checked,
  prefill,
  onCommitted,
}: {
  cwd: string;
  checked: ReadonlySet<string>;
  prefill: { message: string; seq: number } | null;
  onCommitted: () => void;
}) {
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) setMessage(prefill.message);
  }, [prefill]);

  const canCommit = message.trim().length > 0 && (checked.size > 0 || amend);

  const submit = () => {
    if (!canCommit || busy) return;
    setBusy(true);
    setError(null);
    ipc.gitCommit(cwd, [...checked], { message, amend }).then(
      (sha) => {
        setMessage("");
        setAmend(false);
        setBusy(false);
        setError(null);
        console.info(`已提交 ${sha.slice(0, 7)}`);
        onCommitted();
      },
      (e: unknown) => {
        setBusy(false);
        setError(gitErrorDisplay(e));
      },
    );
  };

  return (
    <div className="shrink-0 border-t border-(--tmd-border) p-2">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="提交信息..."
        rows={3}
        className="w-full resize-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) p-2 text-xs outline-none focus:border-(--tmd-accent)"
      />
      {error && (
        <div className="mt-1 rounded bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        <label className="flex items-center gap-1 text-(--tmd-fg-faint)">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
            className="h-3 w-3 accent-(--tmd-accent)"
          />
          amend
        </label>
        <div className="flex items-center gap-2">
          <span className="text-(--tmd-fg-faint)">
            {checked.size === 0 && !amend ? "请先选择要提交的文件" : `已选 ${checked.size} 个文件`}
          </span>
          <button
            onClick={submit}
            disabled={!canCommit || busy}
            className="flex items-center gap-1 rounded bg-(--tmd-accent) px-3 py-1 text-(--tmd-accent-fg) disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            ✓ 提交
          </button>
        </div>
      </div>
    </div>
  );
}
