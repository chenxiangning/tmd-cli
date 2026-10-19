/**
 * composer.toggleHistory(⌘L) 命令桥 —— 历史抽屉开合闭包长在 Composer 组件实例
 * (局部 useState,定稿不进 drawerOpen 三态机),命令 run 无事件面,经 ref 触达
 * (composerSendRef 先例)。
 */
export const historyToggleRef: { current: (() => void) | null } = { current: null };
