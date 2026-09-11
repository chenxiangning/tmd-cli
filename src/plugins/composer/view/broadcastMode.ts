/**
 * 广播开关态 —— 开关长在挂点按钮实例上,发送闭包(useComposerSend)经模块级
 * ref 活读(composerSendRef 同构先例)。跨会话切换/composer 重挂载保持,
 * 平铺关闭时发送路径自动回落单发(开关不重置,再平铺即恢复广播)。
 */
export const broadcastModeRef: { current: boolean } = { current: false };
