/**
 * 分支右键菜单 —— 对齐 codemoss git graph 分支菜单(切换/更新/获取/推送/删除),
 * 视觉走 wsmenu 范式(portal + fixed + backdrop + Escape,复用 FileTreeContextMenu 纪律)。
 *
 * 本地行:切换(二次确认在调用方)/ 更新(pull)/ 获取(刷新上游引用)/ 推送 / 删除
 * 远程行:检出到本地 / 更新(fetch 该分支引用)
 * 无 upstream 的更新/获取禁用并注明原因;busy 期间整组远端操作禁用。
 */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CloudDownload,
  Download,
  GitBranch,
  GitBranchPlus,
  Trash2,
  Upload,
} from "lucide-react";
import type { GitBranchInfo } from "@kernel/ipc";

export interface BranchMenuState {
  x: number;
  y: number;
  branch: GitBranchInfo;
}

export interface BranchMenuActions {
  /** 切换/检出(调用方负责二次确认与执行) */
  checkout: (branch: GitBranchInfo) => void;
  /** 更新:当前分支裸 pull;非当前分支仅 fast-forward 上游引用 */
  pull: (branch: GitBranchInfo) => void;
  /** 获取:只刷新该分支的上游/远端引用 */
  fetch: (branch: GitBranchInfo) => void;
  /** 推送(无 upstream 时自动 -u 建跟踪) */
  push: (branch: GitBranchInfo) => void;
  /** 删除(仅本地;未合并由后端拒绝) */
  remove: (branch: GitBranchInfo) => void;
}

/** 菜单定位:以点击点为左上,按估算尺寸视口内夹取(同 wsmenu 模式)。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - 200 - 12),
    y: Math.min(y, window.innerHeight - 300 - 12),
  };
}

export function BranchContextMenu({
  state,
  currentName,
  busy,
  actions,
  onClose,
}: {
  state: BranchMenuState;
  currentName: string | undefined;
  busy: boolean;
  actions: BranchMenuActions;
  onClose: () => void;
}) {
  const branch = state.branch;
  const isRemote = branch.isRemote;
  const isCurrent = branch.name === currentName;
  const hasUpstream = !isRemote && branch.upstream != null;
  const pos = clampMenuPosition(state.x, state.y);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item = (
    label: string,
    icon: ReactNode,
    onPick: () => void,
    extra?: { danger?: boolean; disabled?: boolean; title?: string },
  ) => (
    <button
      type="button"
      disabled={extra?.disabled}
      title={extra?.title}
      className={`wsmenu-item disabled:opacity-40 disabled:cursor-default${
        extra?.danger ? " is-danger" : ""
      }`}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu session-menu" style={{ left: pos.x, top: pos.y }} role="menu">
        {/* 跟踪摘要头(codemoss branch -> upstream 同款) */}
        <div className="px-3 py-1 text-[10px] text-(--tmd-fg-faint)">
          {branch.name}
          {isRemote ? " → 本地" : branch.upstream ? ` → ${branch.upstream}` : " → (无跟踪)"}
          {isCurrent ? " · 当前" : ""}
        </div>
        <div className="wsmenu-divider" />
        {isRemote
          ? item("检出到本地", <GitBranchPlus size={13} />, () => {
              onClose();
              actions.checkout(branch);
            })
          : item("切换", <GitBranch size={13} />, () => {
              onClose();
              actions.checkout(branch);
            }, { disabled: isCurrent || busy, title: isCurrent ? "已是当前分支" : undefined })}
        <div className="wsmenu-divider" />
        {item("更新", <Download size={13} />, () => {
          onClose();
          actions.pull(branch);
        }, {
          disabled: busy || (!isRemote && !hasUpstream),
          title: !isRemote && !hasUpstream
            ? "无 upstream,无法更新"
            : isCurrent
              ? "跟随上游与 pull.rebase 配置"
              : "仅 fast-forward 该分支引用,不切分支",
        })}
        {item("获取", <CloudDownload size={13} />, () => {
          onClose();
          actions.fetch(branch);
        }, {
          disabled: busy || (!isRemote && !hasUpstream),
          title: !isRemote && !hasUpstream ? "无 upstream" : "只刷新远端引用,不动本地分支",
        })}
        {!isRemote &&
          item("推送", <Upload size={13} />, () => {
            onClose();
            actions.push(branch);
          }, {
            disabled: busy,
            title: branch.upstream ? `推送到 ${branch.upstream}` : "推送并建立 upstream",
          })}
        {!isRemote && (
          <>
            <div className="wsmenu-divider" />
            {item("删除", <Trash2 size={13} />, () => {
              onClose();
              actions.remove(branch);
            }, { danger: true, disabled: isCurrent || busy, title: isCurrent ? "不能删除当前分支" : undefined })}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
