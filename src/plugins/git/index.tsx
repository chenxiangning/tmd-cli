import type { Plugin } from "@kernel/plugin";

/** Git 入口：右侧工具条先固定挂载位，完整面板按 mossx 核心子集继续迁移。 */
function GitRailButton() {
  return (
    <button
      className="rounded p-2 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
      title="Git 管理"
    >
      ⎇
    </button>
  );
}

export const gitPlugin: Plugin = {
  id: "git",
  activate(ctx) {
    ctx.contribute("rightRail", { order: 10, component: GitRailButton });
  },
};
