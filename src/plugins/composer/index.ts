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
import { ComposerToolbar } from "./view/ComposerToolbar";
export const composerPlugin: Plugin = {
  id: "composer",
  meta: { name: "输入区", abbr: "CP", desc: "Composer:富文本输入、附件、建议", category: "core" },
  activate(ctx) {
    ctx.contribute("editorCenter.composer", {
      order: 0,
      component: Composer,
    });
    ctx.contribute("composer.statusBar", {
      order: 0,
      component: ComposerToolbar,
    });
    // 额度以 QuotaChip 内嵌 ComposerToolbar(模型/思考 同一行),不再独立卡片。
  },
};
