/**
 * Git 面板占位 ─ git 完整面板(mossx 核心子集)接入前的友好空态。
 * 实装时只换本组件,注册点(git/index.tsx)与外壳零改动。
 */
export function GitPanel() {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--tmd-fg-faint)">
      Git 面板骨架期未接入,后续由 git 插件提供。
    </div>
  );
}
