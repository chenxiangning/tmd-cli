/**
 * 外壳级命令(shell.*)—— 键位语义归功能所有者:栏折叠/设置/标签页/会话与
 * 右栏面板焦点都是外壳自身功能,故在此模块级注册(内核不含业务命令,同铁律)。
 *
 * 左右栏折叠是 AppShell 组件局部状态(usePersistedToggle),经模块级 ref 桥
 * 喂给命令(先例:TerminalView 的 findRequestRef);其余命令直接调 kernel store。
 */

import { getFilePanels, setFilePanelMode } from "@kernel/filePanel";
import { host } from "@kernel/host";
import { openSettingsPanel } from "@kernel/settings";
import { registerCommand, type ShortcutKeyEvent } from "@kernel/shortcuts";
import { closeTab, getActiveTabId } from "@kernel/tabs";

/** AppShell 局部折叠函数的挂载点:组件挂载期写入,卸载期清空。 */
export const shellBarToggles: {
  left: (() => void) | null;
  right: (() => void) | null;
} = { left: null, right: null };

registerCommand({
  id: "shell.toggleLeftBar",
  title: "折叠/展开左栏",
  keybinding: "Cmd+B",
  run: () => shellBarToggles.left?.(),
});

registerCommand({
  id: "shell.toggleRightBar",
  title: "折叠/展开右栏",
  keybinding: "Cmd+Alt+B",
  run: () => shellBarToggles.right?.(),
});

registerCommand({
  id: "shell.openSettings",
  title: "打开设置",
  keybinding: "Cmd+,",
  run: openSettingsPanel,
});

registerCommand({
  id: "shell.closeTab",
  title: "关闭标签页",
  keybinding: "Cmd+W",
  when: () => getActiveTabId() !== null,
  run: () => {
    const id = getActiveTabId();
    if (id) closeTab(id);
  },
});

registerCommand({
  id: "shell.goHome",
  title: "回到首页",
  keybinding: "Cmd+Shift+H",
  run: () => host.setActiveSession(null),
});

/** match 命中的序号:分发器单线程内先 eventMatches 后 run,同一次按键内成立;
 *  若未来被清单直接调用(未经 match),守卫按无会话处理,不误切。 */
let focusSessionN = 0;

registerCommand({
  id: "shell.focusSessionN",
  title: "切换到第 N 个会话",
  keybindingLabel: "⌘1-9",
  match: (e: ShortcutKeyEvent) => {
    focusSessionN = 0;
    /* 与 parseKeybinding 同语义:Cmd = metaKey/ctrlKey 任一;Shift/Alt 须松开 */
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return false;
    const n = Number(e.key);
    if (!(n >= 1 && n <= 9)) return false; // NaN/0/越界数字一并挡掉
    if (n > host.getSessions().length) return false; // 无此会话 = 不吃键,穿透
    focusSessionN = n;
    return true;
  },
  run: () => {
    const session = host.getSessions()[focusSessionN - 1];
    if (session) host.setActiveSession(session.id);
  },
});

/* 右栏面板按注册表顺序聚焦:panels 注册时已按 order 升序维护(filePanel 范式),
   直接取第 N 个;缺面板时 when 拦下,键穿透。 */
(
  [
    { n: 1, keybinding: "Cmd+Shift+E" },
    { n: 2, keybinding: "Cmd+Shift+G" },
    { n: 3, keybinding: "Cmd+Shift+M" },
  ] as const
).forEach(({ n, keybinding }) =>
  registerCommand({
    id: `shell.focusPanel${n}`,
    title: `切换到面板 ${n}`,
    keybinding,
    when: () => getFilePanels().length >= n,
    run: () => {
      const panel = getFilePanels()[n - 1];
      if (panel) setFilePanelMode(panel.id);
    },
  }),
);
