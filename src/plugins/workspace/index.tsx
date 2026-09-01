import type { Plugin } from "@kernel/plugin";

/**
 * workspace 插件：左侧工作区/会话入口。
 * 工作区切换器后续挂 header.left；当前 rail 先固定入口位置，避免空工具条。
 */
function WorkspaceRailButton() {
  return (
    <button
      className="rounded p-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      title="工作区与会话"
    >
      ▦
    </button>
  );
}

export const workspacePlugin: Plugin = {
  id: "workspace",
  activate(ctx) {
    ctx.contribute("leftRail", {
      order: 0,
      component: WorkspaceRailButton,
    });
  },
};
