/**
 * composer.send 命令桥 —— 发送闭包长在 Composer 组件实例上,命令 run 经此触达
 * (TerminalView findRequestRef 先例:命令注册在插件 activate 期,实例经模块级
 * ref 交接)。自 Composer.tsx 拆出(only-export-components:组件文件只留组件)。
 */
export const composerSendRef: { current: (() => void) | null } = { current: null };
