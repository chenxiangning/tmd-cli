/**
 * composer 插件入口 —— 挂 editorCenter.composer,提供 Composer 视图。
 *
 * v1 实现基线:
 * - textarea + Enter 发送 / Shift+Enter 换行
 * - 走 CLI profile 的 translate 钩子(如 omp 的 $skill → /skill:skill)
 * - Step 4 在此基础上增加触发器下拉 / Step 5 增加拖拽 + 截图
 */

import type { Plugin } from "@kernel/plugin";
import { Composer } from "./view/Composer";

export const composerPlugin: Plugin = {
  id: "composer",
  activate(ctx) {
    ctx.contribute("editorCenter.composer", {
      order: 0,
      component: Composer,
    });
  },
};
