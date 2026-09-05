/**
 * BranchView 行件 —— 自 BranchView.tsx 拆出(文件规模铁则)。
 * GroupLabel = 本地/远程分组吸顶标签;BranchRow = 分支行(当前态高亮 /
 * 远程检出 / 行内两步武装删除:首击标红再击执行,双击后一击强删)。
 */

import { useState } from "react";
import { GitBranch, GitBranchPlus, Trash2 } from "lucide-react";
import type { GitBranchInfo } from "@kernel/ipc";

export function GroupLabel({ label }: { label: string }) {
  return (
    <div className="sticky top-0 mt-1 border-b border-(--tmd-border) bg-(--tmd-bg-base) px-1 py-1 text-[10px] uppercase tracking-wider text-(--tmd-fg-faint)">
      {label}
    </div>
  );
}

export function BranchRow({
  branch,
  isCurrent,
  onCheckout,
  onDelete,
  onMenu,
}: {
  branch: GitBranchInfo;
  isCurrent: boolean;
  onCheckout?: () => void;
  onDelete?: (force: boolean) => void;
  onMenu?: (x: number, y: number) => void;
}) {
  const [confirmForce, setConfirmForce] = useState(false);
  const [armedDelete, setArmedDelete] = useState(false);

  /** 行内删除:两步武装(首击标红,再击执行);未合并的强删由后端拒绝。 */
  const handleDelete = () => {
    if (!onDelete) return;
    if (confirmForce) {
      onDelete(true);
      setConfirmForce(false);
      setArmedDelete(false);
      return;
    }
    if (armedDelete) {
      onDelete(false);
      setArmedDelete(false);
      return;
    }
    setArmedDelete(true);
  };

  return (
    <div
      className={`group flex items-center gap-1.5 rounded px-2 py-1 ${
        isCurrent ? "bg-(--tmd-accent-soft)" : "hover:bg-(--tmd-bg-hover)"
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu?.(e.clientX, e.clientY);
      }}
    >
      <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-faint)" />
      <button
        onClick={isCurrent ? undefined : onCheckout}
        className={`min-w-0 flex-1 truncate text-left ${
          isCurrent ? "cursor-default font-medium text-(--tmd-accent)" : ""
        }`}
        title={
          branch.isRemote
            ? "点击检出为本地分支并建跟踪;右键更多操作"
            : branch.upstream
              ? `上游:${branch.upstream};右键更多操作`
              : "右键更多操作"
        }
      >
        {branch.name}
        {isCurrent && <span className="ml-1 text-[10px]">(当前)</span>}
      </button>
      {branch.isRemote && onCheckout && (
        <button
          onClick={onCheckout}
          title="检出为本地分支并建跟踪"
          className="shrink-0 opacity-0 group-hover:opacity-60"
        >
          <GitBranchPlus className="h-3.5 w-3.5" />
        </button>
      )}
      {!branch.isRemote && !isCurrent && onDelete && (
        <button
          onClick={handleDelete}
          onDoubleClick={() => setConfirmForce(true)}
          title={confirmForce ? "再次点击强制删除(未合并)" : "删除;未合并时点两次后强制"}
          className={`shrink-0 opacity-0 group-hover:opacity-60 ${
            confirmForce || armedDelete ? "text-(--tmd-diff-removed) opacity-100!" : ""
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
