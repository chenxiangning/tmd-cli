/**
 * terminal.find 命令桥(spec 2026-09-05-shortcuts)—— 自 terminalSearch.tsx 拆出
 * (组件文件不携带非组件导出)。
 * 终端内自由快捷键一律不变:键照旧进 PTY,只有 terminal 作用域命令经分发器触发。
 * 一期唯一成员 terminal.find(⌘F,行为与桥接入前完全一致);搜索 UI 归内核终端
 * 本体,故命令在此登记,激活的组件实例经 findRequestRef 接收触发。
 */
import { registerCommand } from "@kernel/shortcuts";

export const findRequestRef: { current: (() => void) | null } = { current: null };
registerCommand({
  id: "terminal.find",
  title: "终端搜索",
  keybinding: "Cmd+F",
  scope: "terminal",
  run: () => findRequestRef.current?.(),
});
