/**
 * 详情页右键菜单的行构造与 pick 类型 —— 与 FileTreeContextMenu.item 同款
 * (多快捷键提示/禁用/武装态)。非组件模块:菜单壳文件保 300 行铁则。
 */

import type { ReactNode } from "react";

/** pick 包装:先执行菜单收口,再跑动作(菜单不因异步动作挂开着)。 */
export type Pick = (run: () => void) => void;

/** 菜单行构造(快捷键提示/禁用/danger 武装态)。 */
export function item(
  label: string,
  icon: ReactNode,
  onPick: () => void,
  extra?: { kbd?: string; disabled?: boolean; danger?: boolean },
) {
  return (
    <button
      type="button"
      className={`wsmenu-item${extra?.danger ? " is-danger" : ""}`}
      disabled={extra?.disabled}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
      {extra?.kbd ? <span className="wsmenu-item-kbd">{extra.kbd}</span> : null}
    </button>
  );
}
