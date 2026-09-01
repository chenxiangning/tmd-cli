import type { Plugin } from "@kernel/plugin";

/**
 * composer 插件（骨架）—— 本项目核心诉求，对标 mossx 对话框。
 * 实装基线：docs/research/mossx-composer-capabilities.md 的 14 项 v1 清单。
 * 发送通道汇流：composer 组装的文本经触发符 translate 后写 ipc.sessionWrite（bracketed paste）。
 */
export const composerPlugin: Plugin = {
  id: "composer",
  activate() {
    // 骨架：无贡献。第一刀实装 = 幕布下方输入框 + bracketed paste 注入。
  },
};
