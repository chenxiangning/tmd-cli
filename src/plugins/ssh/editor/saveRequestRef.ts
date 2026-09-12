/**
 * ssh.saveRemoteFile 命令桥 —— 挂载中的远端文件 tab 实例经此接收保存触发。
 * 自 RemoteFileTab.tsx 拆出(only-export-components);模块级 ref 桥先例:
 * files saveRequestRef / TerminalView.findRequestRef。
 */

export const saveRequestRef: { current: (() => void) | null } = { current: null };
