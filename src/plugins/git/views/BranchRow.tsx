/**
 * BranchView 行件 —— 自 BranchView.tsx 拆出(文件规模铁则)。
 * GroupLabel = 本地/远程分组吸顶标签;BranchRow = 分支行(当前态高亮 /
 * 远程检出 / 行内两步武装删除:首击标红再击执行,双击后一击强删);
 * BranchSearchBox = 分支搜索框;GitOpBanner = 错误/提示/执行中反馈三态。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { CircleNotch, GitBranch, Plus, Trash } from "@phosphor-icons/react";
import type { GitBranchInfo } from "@kernel/ipc";

export function GroupLabel({ label }: { label: string }) {
  return (
    <div className="sticky top-0 mt-1 border-b border-(--tmd-border) bg-(--tmd-bg-base) px-1 py-1 text-[0.625rem] uppercase tracking-wider text-(--tmd-fg-faint)">
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
      <GitBranch className="h-[0.875rem] w-[0.875rem] shrink-0 text-(--tmd-fg-faint)" />
      <button
        onClick={isCurrent ? undefined : onCheckout}
        className={`min-w-0 flex-1 truncate text-left ${
          isCurrent ? "cursor-default font-medium text-(--tmd-accent)" : ""
        }`}
        title={
          branch.isRemote
            ? t("点击检出为本地分支并建跟踪;右键更多操作")
            : branch.upstream
              ? t("上游:{upstream};右键更多操作", { upstream: branch.upstream })
              : t("右键更多操作")
        }
      >
        {branch.name}
        {isCurrent && <span className="ml-1 text-[0.625rem]">{t("(当前)")}</span>}
      </button>
      {branch.isRemote && onCheckout && (
        <button
          onClick={onCheckout}
          title={t("检出为本地分支并建跟踪")}
          className="shrink-0 opacity-0 group-hover:opacity-60"
        >
          <GitBranch className="h-[0.875rem] w-[0.875rem]" />
        </button>
      )}
      {!branch.isRemote && !isCurrent && onDelete && (
        <button
          onClick={handleDelete}
          onDoubleClick={() => setConfirmForce(true)}
          title={confirmForce ? t("再次点击强制删除(未合并)") : t("删除;未合并时点两次后强制")}
          className={`shrink-0 opacity-0 group-hover:opacity-60 ${
            confirmForce || armedDelete ? "text-(--tmd-diff-removed) opacity-100!" : ""
          }`}
        >
          <Trash className="h-[0.875rem] w-[0.875rem]" />
        </button>
      )}
    </div>
  );
}

/** 分支搜索框:值受控于 BranchView,按名称子串过滤本地/远程两组。 */
export function BranchSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("搜索分支…")}
      className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
    />
  );
}

/** 新建分支行:BranchView 折叠态展开时才渲染;Enter 等价点击创建钮。 */
export function BranchCreateRow({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder={t("新分支名...")}
        className="min-w-0 flex-1 rounded border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-xs outline-none focus:border-(--tmd-accent)"
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || busy}
        title={t("基于当前 HEAD 创建")}
        className="rounded bg-(--tmd-accent) p-1.5 text-(--tmd-accent-fg) disabled:opacity-40"
      >
        <Plus className="h-[0.875rem] w-[0.875rem]" />
      </button>
    </div>
  );
}

/** 操作反馈三态:错误(红)/ 成功提示(灰)/ 执行中 spinner。 */
export function GitOpBanner({
  error,
  notice,
  busy,
}: {
  error: string | null;
  notice: string | null;
  busy: boolean;
}) {
  return (
    <>
      {error && (
        <div className="rounded bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg-muted)">
          {notice}
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-1.5 text-(--tmd-fg-faint)">
          <CircleNotch className="h-[0.75rem] w-[0.75rem] animate-spin" /> {t("执行中…")}
        </div>
      )}
    </>
  );
}
