/**
 * BranchView —— 分支视图:本地/远程分组 + 创建 / checkout / 删除。
 *
 * checkout 脏工作区冲突:libgit2 safe 模式拒绝 → E_GIT2 文案展示,不擅自 force。
 * 删除:未合并分支后端拒绝(E_EMPTY),前端提供 force 二次确认。
 */

import { useState } from "react";
import { GitBranch, Loader2, Plus, Trash2 } from "lucide-react";
import { ipc, type GitBranchInfo, type GitBranchList } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";

interface Props {
  cwd: string;
  data: GitBranchList | null;
  loading: boolean;
  currentName: string | undefined;
  onMutation: () => void;
}

export function BranchView({ cwd, data, loading, currentName, onMutation }: Props) {
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action().then(
      () => {
        setBusy(false);
        onMutation();
      },
      (e: unknown) => {
        setBusy(false);
        setError(gitErrorDisplay(e));
      },
    );
  };

  const createBranch = () => {
    const name = newName.trim();
    if (!name) return;
    run(() => ipc.gitCreateBranch(cwd, name).then(() => setNewName("")));
  };

  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createBranch()}
          placeholder="新分支名..."
          className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
        />
        <button
          onClick={createBranch}
          disabled={!newName.trim() || busy}
          title="基于当前 HEAD 创建"
          className="rounded bg-(--tmd-accent) p-1.5 text-(--tmd-accent-fg) disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <div className="rounded bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-1.5 text-(--tmd-fg-faint)">
          <Loader2 className="h-3 w-3 animate-spin" /> 执行中…
        </div>
      )}

      <GroupLabel label={`本地 (${data?.local.length ?? 0})`} />
      {data?.local.map((b) => (
        <BranchRow
          key={b.name}
          branch={b}
          isCurrent={b.name === currentName}
          onCheckout={() => run(() => ipc.gitCheckout(cwd, b.name))}
          onDelete={(force) => run(() => ipc.gitDeleteBranch(cwd, b.name, force))}
        />
      ))}
      {loading && !data && <div className="px-2 py-1 text-(--tmd-fg-faint)">加载中…</div>}

      <GroupLabel label={`远程 (${data?.remote.length ?? 0})`} />
      {data?.remote.map((b) => <BranchRow key={b.name} branch={b} isCurrent={false} />)}
    </div>
  );
}

function GroupLabel({ label }: { label: string }) {
  return (
    <div className="sticky top-0 mt-1 border-b border-(--tmd-border) bg-(--tmd-bg-base) px-1 py-1 text-[10px] uppercase tracking-wider text-(--tmd-fg-faint)">
      {label}
    </div>
  );
}

function BranchRow({
  branch,
  isCurrent,
  onCheckout,
  onDelete,
}: {
  branch: GitBranchInfo;
  isCurrent: boolean;
  onCheckout?: () => void;
  onDelete?: (force: boolean) => void;
}) {
  const [confirmForce, setConfirmForce] = useState(false);

  const handleDelete = () => {
    if (!onDelete) return;
    if (confirmForce) {
      // 第二击:强制删除(未合并)
      onDelete(true);
      setConfirmForce(false);
      return;
    }
    if (!window.confirm(`删除分支 ${branch.name}?`)) return;
    onDelete(false);
  };

  return (
    <div
      className={`group flex items-center gap-1.5 rounded px-2 py-1 ${
        isCurrent ? "bg-(--tmd-accent-soft)" : "hover:bg-(--tmd-bg-hover)"
      }`}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" />
      <button
        onClick={isCurrent ? undefined : onCheckout}
        className={`min-w-0 flex-1 truncate text-left ${
          isCurrent ? "cursor-default font-medium text-(--tmd-accent)" : ""
        }`}
        title={branch.upstream ? `上游:${branch.upstream}` : branch.lastCommitSummary}
      >
        {branch.name}
        {isCurrent && <span className="ml-1 text-[10px]">(当前)</span>}
      </button>
      {!branch.isRemote && !isCurrent && onDelete && (
        <button
          onClick={handleDelete}
          onDoubleClick={() => setConfirmForce(true)}
          title={confirmForce ? "再次点击强制删除(未合并)" : "删除;未合并时点两次后强制"}
          className={`shrink-0 opacity-0 group-hover:opacity-60 ${
            confirmForce ? "text-(--tmd-diff-removed) opacity-100!" : ""
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
