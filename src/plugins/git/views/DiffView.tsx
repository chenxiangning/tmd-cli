/**
 * DiffView —— 差异视图:聚合行 + 文件列表(树/平铺)+ 提交 composer。
 * 文件行点击不再内联展开 patch —— 统一在中央文件开启位置开 git-diff tab
 * (选侧规则:wt 优先,即 staged=true 仅当已暂存且工作区无叠加改动)。
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
import { ipc, type GitFileStatus } from "@kernel/ipc";
import type { FileListLayout } from "../panelStore";
import { openDiffTab } from "../diffTab";
import { buildTree } from "./diffTree";
import { gitErrorDisplay } from "../gitError";
import { STATUS_COLOR } from "./statusColor";

interface Props {
  cwd: string;
  layout: FileListLayout;
  files: GitFileStatus[];
  prefill: { message: string; seq: number } | null;
  onMutation: () => void;
}

export function DiffView({ cwd, layout, files, prefill, onMutation }: Props) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());

  // 文件消失(已提交/还原)时同步掉勾选
  useEffect(() => {
    const live = new Set(files.map((f) => f.path));
    setChecked((prev) => {
      const next = new Set([...prev].filter((p) => live.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

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
              onToggleCheck={() => toggleCheck(row.file.path)}
              onOpen={() =>
                // wt 优先:暂存后又改的复合文件,看 worktree 侧(= 勾选提交的实际内容)
                openDiffTab({
                  cwd,
                  path: row.file.path,
                  staged: row.file.staged && !row.file.wt,
                  status: row.file.status,
                })
              }
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
          onMutation();
        }}
      />
    </div>
  );
}

/* ── 文件行:勾选框 + 打开 diff(中央 tab)+ hover stage/discard ── */

function FileRow({
  file,
  depth,
  checked,
  onToggleCheck,
  onOpen,
  onStage,
  onUnstage,
  onDiscard,
}: {
  file: GitFileStatus;
  depth: number;
  checked: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
}) {
  const isConflict = file.status === "C";
  const displayStatus = file.status === "?" ? "U" : file.status;
  return (
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
        type="button"
        onClick={onOpen}
        title={`${file.path}(点击在中间打开 diff)`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" />
        <span className="min-w-0 flex-1 truncate">{depth > 0 ? file.path.slice(file.path.indexOf("/") + 1) : file.path}</span>
        <span className={`font-mono text-[10px] ${STATUS_COLOR[file.status] ?? ""}`}>
          {displayStatus}
        </span>
      </button>
      {!isConflict && (
        <button
          type="button"
          onClick={file.staged ? onUnstage : onStage}
          title={file.staged ? "unstage" : "stage"}
          className="w-4 shrink-0 text-center opacity-0 hover:text-(--tmd-accent) group-hover:opacity-60"
        >
          {file.staged ? "−" : "+"}
        </button>
      )}
      {file.wt && !isConflict && (
        <button
          type="button"
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
