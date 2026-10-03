/**
 * 界面缩放键位(⌘+ / ⌘− / ⌘0)—— 底栏缩放组隐藏后的替代入口
 * (2026-10-04 UI 微调;数值仍走 settings.uiZoom,设置页外观卡同源可调)。
 *
 * 自 shortcutCommands.ts 拆出仅守 300 行铁则,AppShell 挂载期随同导入注册。
 * ⌘+ 在 mac 实键是「⌘⇧=」(e.key="+")与「⌘=」两态,match 一并收下;
 * ⌘−/⌘0 语法虽可静态表达,仍取 match = 三键家族一致,有意放弃改键
 * (isShortcutRemappable = 非 match)与静态冲突检测 —— 三个缩放键作为一组
 * 平台惯例键,不进改键面;先例 ⌘1-9 / ⌃⌘F / Ctrl+Tab。
 * 越界档由 kernel 设置层 sanitize 钳位(0.8–1.5,5% 一档),此处不重复钳。
 */

import { registerCommand, type ShortcutKeyEvent } from "@kernel/shortcuts";
import { getPlatformKind } from "@kernel/platform";
import {
  UI_ZOOM_DEFAULT,
  UI_ZOOM_STEP,
  getSettingsState,
  updateSettings,
} from "@kernel/settings";

/** Cmd 按下判定:与 eventMatches 平台严格分流同口径(shortcuts.ts)——
 *  mac 仅 metaKey(mac 的 Ctrl±/Ctrl+0 是终端/emacs 键生态,不得劫持)、
 *  win/linux 仅 ctrlKey、unknown 双任一兜底;alt 一律排除(⌥± 是特殊字符输入)。 */
function cmdPressed(e: ShortcutKeyEvent): boolean {
  if (e.altKey) return false;
  const kind = getPlatformKind();
  if (kind === "macos") return e.metaKey;
  if (kind === "unknown") return e.metaKey || e.ctrlKey;
  return e.ctrlKey;
}

registerCommand({
  id: "shell.zoomIn",
  title: "放大界面",
  keybindingLabel: "⌘+",
  match: (e) => cmdPressed(e) && (e.key === "=" || e.key === "+"),
  run: () => updateSettings({ uiZoom: getSettingsState().settings.uiZoom + UI_ZOOM_STEP }),
});

registerCommand({
  id: "shell.zoomOut",
  title: "缩小界面",
  keybindingLabel: "⌘−",
  match: (e) => cmdPressed(e) && !e.shiftKey && e.key === "-",
  run: () => updateSettings({ uiZoom: getSettingsState().settings.uiZoom - UI_ZOOM_STEP }),
});

registerCommand({
  id: "shell.zoomReset",
  title: "重置界面缩放",
  keybindingLabel: "⌘0",
  match: (e) => cmdPressed(e) && !e.shiftKey && e.key === "0",
  run: () => updateSettings({ uiZoom: UI_ZOOM_DEFAULT }),
});
