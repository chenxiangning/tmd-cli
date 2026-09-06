/**
 * 默认贡献器 —— AppShell 内嵌 UI 全部经挂点贡献,保持可替换。
 * 幂等注册:StrictMode 双调 / HMR 不会重复挂。
 *
 * 顶部 toolbar 接会话标题 tab 条与编辑 tab 条;session 详情通过中央幕布承载(terminal + file tabs)。
 */

import type { MountContribution, MountPoint } from "@kernel/plugin";
import { SessionTabBar } from "./SessionTabBar";
import { EditorTabStrip } from "./EditorTabStrip";
/** 装配入口:由 main.tsx 调用,把内置 UI 注册到挂点。幂等。 */
let registered = false;
export function registerDefaultContributions(ctx: {
  contribute: (point: MountPoint, contribution: MountContribution) => void;
}): void {
  if (registered) return;
  registered = true;
  ctx.contribute("header.breadcrumb", {
    order: 200,
    component: SessionTabBar,
  });
  /* 编辑 tab 条(文件/记忆/diff):会话 tab 条右侧同排,双激活并存(2026-09-06 架构改) */
  ctx.contribute("header.breadcrumb", {
    order: 300,
    component: EditorTabStrip,
  });
}