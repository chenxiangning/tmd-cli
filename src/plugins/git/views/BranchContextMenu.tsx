/**
 * 分支右键菜单 —— 对齐 codemoss git graph 分支菜单全 11 项语义,
 * 视觉走 wsmenu 范式(portal + fixed + backdrop + Escape,复用 FileTreeContextMenu 纪律)。
 *
 * 顺序与禁用规则同 codemoss:
 *   签出 / 从 X 新建分支... / 签出并变基到 <current>(仅本地非当前)
 *   与 <current> 比较(非当前)/ 显示与工作树的差异
 *   将 <current> 变基到 <branch>(仅本地非当前)/ 将 <branch> 合并到 <current>(仅本地非当前)
 *   更新 / 获取(tmd-cli 超集:单分支引用刷新)/ 推送...(仅当前,开对话框)
 *   重命名...(仅本地)/ 删除(仅本地非当前,danger)
 * 无 upstream 的更新/获取禁用并注明原因;busy 期间整组禁用;
 * 跟踪摘要头(codemoss branch -> upstream 同款)常驻菜单顶部。
 * 菜单项本体拆至 branchMenuGroups.tsx(no-high-complexity 降分支)。
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "@kernel/i18n";
import type { GitBranchInfo } from "@kernel/ipc";
import { BranchMenuItems, type MenuCtx } from "./branchMenuGroups";

export interface BranchMenuState {
  x: number;
  y: number;
  branch: GitBranchInfo;
}

export interface BranchMenuActions {
  /** 切换/检出(调用方负责二次确认与执行) */
  checkout: (branch: GitBranchInfo) => void;
  /** 从该分支新建分支(对话框) */
  createFrom: (branch: GitBranchInfo) => void;
  /** 签出该分支并变基到「先前当前分支」(调用方二次确认) */
  checkoutRebase: (branch: GitBranchInfo) => void;
  /** 与当前分支比较(双列提交弹窗) */
  compareWithCurrent: (branch: GitBranchInfo) => void;
  /** 显示工作树与该分支的差异(文件清单弹窗) */
  diffWithWorktree: (branch: GitBranchInfo) => void;
  /** 将当前分支变基到该分支(调用方二次确认) */
  rebaseCurrentOnto: (branch: GitBranchInfo) => void;
  /** 将该分支合并到当前分支(调用方二次确认) */
  mergeIntoCurrent: (branch: GitBranchInfo) => void;
  /** 更新:当前分支裸 pull;非当前分支仅 fast-forward 上游引用 */
  pull: (branch: GitBranchInfo) => void;
  /** 获取:只刷新该分支的上游/远端引用 */
  fetch: (branch: GitBranchInfo) => void;
  /** 推送当前分支(打开推送对话框) */
  push: (branch: GitBranchInfo) => void;
  /** 重命名(仅本地;对话框) */
  rename: (branch: GitBranchInfo) => void;
  /** 删除(仅本地;未合并由后端拒绝) */
  remove: (branch: GitBranchInfo) => void;
}

/** 首帧估算定位(初值防闪);渲染后按实测尺寸二次夹取,见下方 useLayoutEffect。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - 220 - 12),
    y: Math.min(y, window.innerHeight - 420 - 12),
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
  const hasCurrent = currentName != null && currentName !== "";
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => clampMenuPosition(state.x, state.y));

  /* 长分支名会把菜单撑得比估算宽得多(固定 220px 估宽会被视口右缘裁剪)——
   * 渲染后按 offsetWidth/Height 实测夹取:右缘放不下整体贴右(向左展开),
   * 底缘放不下贴底。useLayoutEffect 在绘制前完成,无跳动。 */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = state.x;
    if (left + w > vw - 8) left = vw - w - 8;
    left = Math.max(8, left);
    let top = state.y;
    if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    setPos({ x: left, y: top });
  }, [state.x, state.y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ctx: MenuCtx = {
    branch,
    currentName,
    isRemote,
    isCurrent,
    hasUpstream,
    hasCurrent,
    busy,
    actions,
    onClose,
  };

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="wsmenu session-menu"
        style={{ left: pos.x, top: pos.y }}
        role="menu"
      >
        {/* 跟踪摘要头(codemoss branch -> upstream 同款) */}
        <div className="px-3 py-1 text-[0.625rem] text-(--tmd-fg-faint)">
          {branch.name}
          {isRemote
            ? t(" → 本地")
            : branch.upstream
              ? ` → ${branch.upstream}`
              : t(" → (无跟踪)")}
          {isCurrent ? t(" · 当前") : ""}
        </div>
        <div className="wsmenu-divider" />
        <BranchMenuItems ctx={ctx} />
      </div>
    </>,
    document.body,
  );
}
