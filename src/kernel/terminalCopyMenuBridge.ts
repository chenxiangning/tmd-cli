/**
 * terminal.copyMenu 命令桥(2026-09-11 诉求)—— 同 terminalFindBridge 先例:
 * Cmd/Ctrl+C 聚焦期不再直穿 PTY(Windows 下误中断 CLI 对话),改弹复制/停止菜单;
 * 菜单 UI 归内核幕布本体,命令在此登记,激活的组件实例经 copyMenuRequestRef 接收触发。
 */
import { registerCommand } from "@kernel/shortcuts";

export const copyMenuRequestRef: { current: (() => void) | null } = { current: null };
registerCommand({
  id: "terminal.copyMenu",
  title: "终端复制/停止菜单",
  keybinding: "Cmd+C",
  scope: "terminal",
  run: () => copyMenuRequestRef.current?.(),
});
