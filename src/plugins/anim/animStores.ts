/**
 * anim · 中央 tab 契约与打开封装(纯函数自 index.tsx 拆出守
 * only-export-components,先例 workbench/wbTabs)。
 */

import { t } from "@kernel/i18n";
import { openTab } from "@kernel/tabs";

/** tmd-anim 项目列表中央 tab(kernel/tabs kind 路由注册表)。 */
export const ANIM_TAB_KIND = "anim.projects";
export const ANIM_TAB_ID = "anim-projects";

/** 打开/激活项目列表 tab(侧栏入口共用;openTab 幂等语义)。 */
export function openAnimTab(): void {
  openTab({
    id: ANIM_TAB_ID,
    kind: ANIM_TAB_KIND,
    title: t("动画项目"),
    path: "tmd-anim",
    payload: {},
  });
}

/* 「新建 AI 会话」请求桥(anim.new-session 命令 → 项目列表 tab 消费):
 * tab 非 keepAlive(切走即卸载),命令先 openAnimTab 再挂旗;tab 侧在 home
 * 就绪后消费(首拍数据落地/订阅通知),未就绪留旗不弹(避免「主目录未就绪」误报)。 */
let aiDialogRequest = false;
const aiDialogListeners = new Set<() => void>();

/** 命令侧:请求弹出「关联 AI 会话」确认窗(挂旗幂等 + 通知已挂载的 tab)。 */
export function requestAiDialog(): void {
  aiDialogRequest = true;
  aiDialogListeners.forEach((fn) => fn());
}

/** tab 侧:消费挂起的请求;无请求返回 false 不动。 */
export function consumeAiDialogRequest(): boolean {
  if (!aiDialogRequest) return false;
  aiDialogRequest = false;
  return true;
}

/** 订阅请求到达(tab 已挂载时的即时消费通道)。 */
export function subscribeAiDialogRequest(fn: () => void): () => void {
  aiDialogListeners.add(fn);
  return () => aiDialogListeners.delete(fn);
}
