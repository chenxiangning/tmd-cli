/**
 * 外壳级命令(shell.*)—— 键位语义归功能所有者:栏折叠/设置/标签页/会话与
 * 右栏面板焦点都是外壳自身功能,故在此模块级注册(内核不含业务命令,同铁律)。
 *
 * 左右栏折叠是 AppShell 组件局部状态(usePersistedToggle),经模块级 ref 桥
 * 喂给命令(先例:TerminalView 的 findRequestRef);其余命令直接调 kernel store。
 */

import {
  getFilePanelMode,
  getFilePanels,
  setFilePanelMode,
} from "@kernel/filePanel";
import { host } from "@kernel/host";
import { openSettingsPanel } from "@kernel/settings";
import { registerCommand, type ShortcutKeyEvent } from "@kernel/shortcuts";
import {
  closeTab,
  getActiveTabId,
  getTabs,
  setActiveTab,
} from "@kernel/tabs";
import { toggleEditorMaximized } from "./editorMaximized";

/** AppShell 局部折叠函数的挂载点:组件挂载期写入,卸载期清空。 */
export const shellBarToggles: {
  left: (() => void) | null;
  right: (() => void) | null;
} = { left: null, right: null };

/** AppShell 市场页开合函数挂载点(组件局部 state,同 bars 桥)。 */
export const shellMarketToggle: { current: (() => void) | null } = { current: null };

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

/* tab 顺序切换:浏览器/VS Code 惯例 Ctrl+Tab / Ctrl+Shift+Tab。
   match 型 (meta||ctrl):mac 上 ⌘Tab 被 OS 截走,"Cmd+Tab" 键位串只匹配 metaKey、
   从未生效(2026-09-06 修);Tab 非 PTY 可写键,终端内无劫持。 */
function focusNeighborTab(offset: 1 | -1): void {
  const tabs = getTabs();
  const activeId = getActiveTabId();
  const idx = tabs.findIndex((t) => t.id === activeId);
  if (idx === -1 || tabs.length < 2) return;
  const next = tabs[(idx + offset + tabs.length) % tabs.length];
  setActiveTab(next.id);
}
registerCommand({
  id: "shell.nextTab",
  title: "下一个标签页",
  keybindingLabel: "Ctrl+Tab",
  match: (e) => (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === "Tab",
  when: () => getTabs().length >= 2,
  run: () => focusNeighborTab(1),
});
registerCommand({
  id: "shell.prevTab",
  title: "上一个标签页",
  keybindingLabel: "Ctrl+⇧Tab",
  match: (e) => (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === "Tab",
  when: () => getTabs().length >= 2,
  run: () => focusNeighborTab(-1),
});

/* 编辑区最大化:⌘⌥F(mac 全屏心智 ⌃⌘F 的可达变体;⌃⌘ 键位语法无法表达,
   经 match 自定义匹配双修饰键)。 */
registerCommand({
  id: "shell.toggleEditorMaximized",
  title: "最大化/还原编辑区",
  keybindingLabel: "⌃⌘F",
  match: (e) => e.metaKey && e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f",
  when: () => getTabs().length > 0,
  run: () => toggleEditorMaximized(),
});

/* 插件市场:⌘⇧X(对齐 VS Code 扩展视图)。开合是 AppShell 组件 state,经 ref 桥。 */
registerCommand({
  id: "shell.openMarket",
  title: "插件市场",
  keybinding: "Cmd+Shift+X",
  when: () => shellMarketToggle.current !== null,
  run: () => shellMarketToggle.current?.(),
});

/* 右栏面板动作:作用于激活面板的注册槽(刷新/新建文件/新建文件夹),
   无键位仅暴露;槽缺失(面板未提供)时 when 拦下,键穿透。 */
(
  [
    { id: "panel.refresh", title: "刷新当前面板", slot: "refresh" },
    { id: "panel.newFile", title: "新建文件", slot: "newFile" },
    { id: "panel.newFolder", title: "新建文件夹", slot: "newFolder" },
  ] as const
).forEach(({ id, title, slot }) =>
  registerCommand({
    id,
    title,
    when: () => {
      const mode = getFilePanelMode();
      const panel = getFilePanels().find((p) => p.id === mode);
      return panel?.[slot] != null;
    },
    run: () => {
      const mode = getFilePanelMode();
      const panel = getFilePanels().find((p) => p.id === mode);
      void panel?.[slot]?.();
    },
  }),
);
