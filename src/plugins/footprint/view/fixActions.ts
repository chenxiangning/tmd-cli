/**
 * footprint 修正菜单动作清单(菜单渲染与动作分发共用)。
 * 自 FpOverlays 拆出守 only-export-components。
 */

/** 修正菜单动作(顺序即菜单展示序)。 */
export const FIX_ACTIONS = ["重命名功能卡", "合并到其他卡…", "拆分此卡…", "标记为无关"] as const;
