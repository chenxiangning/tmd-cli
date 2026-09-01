import type { Plugin } from "@kernel/plugin";

/**
 * workspace 插件（骨架）：工作区管理。
 * 实装方向：多工作区注册/切换、cwd 注入会话创建、左栏工作区切换器挂载 header.left。
 * 骨架期 cwd 由外壳硬编码，本插件先占位以固定边界。
 */
export const workspacePlugin: Plugin = {
  id: "workspace",
  activate() {
    // 骨架：无贡献。第一刀实装 = 工作区 store + header 切换器。
  },
};
