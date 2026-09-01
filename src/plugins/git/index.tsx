import type { Plugin } from "@kernel/plugin";

/** Git 插件入口：v1 移除左右 rail,git 完整面板按 mossx 子集后续接入。 */

export const gitPlugin: Plugin = {
  id: "git",
    activate() {
    // 暂无 UI 贡献;保留插件位以便后续 git 面板接入。
  },
};
