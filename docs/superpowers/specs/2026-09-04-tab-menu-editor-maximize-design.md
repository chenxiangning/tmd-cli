# 文件 tab 右键菜单 + 编辑区最大化/还原切换

日期:2026-09-04
状态:已落地(2026-09-04;typecheck / 架构边界 / 文件规模 / vitest 全绿,`pnpm tauri:dev` 目检)

## 背景与目标

中央文件展示区的 tab 条目前只有「在新窗口打开」占位按钮(仅 console.info)和 × 关闭,缺少 tab 级批量管理;「在新窗口打开」长期是占位,用户实际诉求是快速把文件区放大查看。

目标:

1. tab 右键菜单:`关闭` / `关闭其他 tab` / `关闭全部 tab`;
2. tab 上的占位 detach 按钮换成「最大化查看 / 还原」切换:最大化时编辑区通栏占满(隐藏左 session 栏、中央幕布、右文件面板),再点还原三栏;状态持久化。

## 方案取舍

**选定:**

- 菜单:新增 `src/app-shell/TabContextMenu.tsx`,复刻 `SessionContextMenu` 的 wsmenu 范式(portal + fixed + backdrop + Escape 关闭,视口内夹取定位)。菜单作用于被右键的 tab,不强制激活。
- kernel:`tabs.ts` 新增 `closeOtherTabs(id)` / `closeAllTabs()`;dirty tab 不加确认,与现有 × 按钮语义一致。
- 最大化:新增 `src/app-shell/editorMaximized.ts` 小组件级 store(useSyncExternalStore + localStorage `shell.editorMax`),`FileTab` 按钮与 `AppShell` 布局双端消费同一 store;AppShell 在最大化且存在 tab 时横向 group 只渲染 editor Panel,其余栏与拖把手隐藏,TopBar 不变;无 tab 时标志不生效。
- icon:lucide `Maximize2`(普通态)/ `Minimize2`(最大化态),title/aria-label 为「最大化查看」/「还原」。

**否决:**

- 复用 `usePersistedToggle` 做最大化状态:它是组件内 useState,按钮与布局两处消费会分叉,必须升级为共享 store。
- 从 shell import plugins 的 `clampMenuPosition`:违反分层方向(plugins 依赖 shell,不反向),在本地实现简化版夹取。
- 最大化只压缩中央幕布或只藏左右栏:用户明确选定通栏占满。

## 验证

`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`tabs.test.ts` 补 closeOtherTabs/closeAllTabs 用例;`pnpm tauri:dev` 目检右键菜单三项与最大化/还原切换。
