/**
 * 终端字号缩放键位(⌘+/⌘−/⌘0,042 随手带)—— 聚焦幕布时 terminal 作用域优先
 * (resolveCommand 聚焦优先语义):命中即拦截缩放终端字号;未聚焦回落 global
 * shell.zoomIn/Out/Reset 界面缩放,两族互不占键。数值走 settings.terminalFontSize
 * (10–20 整数,步进 1,缩放键在写入前按 MIN/MAX 夹取),与设置页外观卡同源,
 * TerminalView 订阅即时重排。match 键族与 app-shell/zoomCommands 同平台口径
 * (有意放弃改键面,先例 ⌘1-9/⌃⌘F);命令桥先例 terminalFindBridge。
 */
import { registerCommand, type ShortcutKeyEvent } from "@kernel/shortcuts";
import { getPlatformKind } from "@kernel/platform";
import { TERMINAL_FONT_SIZE_DEFAULT, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX, getSettingsState, updateSettings } from "@kernel/settings";
import { t } from "@kernel/i18n";

/** Cmd 按下判定:与 shortcuts.ts eventMatches 平台严格分流同口径——
 *  mac 仅 metaKey(mac 的 Ctrl± 是终端/emacs 键生态,不得劫持)、
 *  win/linux 仅 ctrlKey、unknown 双任一兜底;alt 一律排除(⌥± 是特殊字符输入)。 */
function cmdPressed(e: ShortcutKeyEvent): boolean {
  if (e.altKey) return false;
  const kind = getPlatformKind();
  if (kind === "macos") return e.metaKey;
  if (kind === "unknown") return e.metaKey || e.ctrlKey;
  return e.ctrlKey;
}

registerCommand({
  id: "terminal.zoomIn",
  title: t("放大终端字号"),
  keybindingLabel: "⌘+",
  scope: "terminal",
  match: (e) => cmdPressed(e) && (e.key === "=" || e.key === "+"),
  run: () => {
    // settings 层 sanitize 是越界回落默认(非钳位),这里必须先夹取,防 20 再按 ⌘+ 骤缩回 13
    const cur = getSettingsState().settings.terminalFontSize;
    updateSettings({ terminalFontSize: Math.min(TERMINAL_FONT_SIZE_MAX, cur + 1) });
  },
});

registerCommand({
  id: "terminal.zoomOut",
  title: t("缩小终端字号"),
  keybindingLabel: "⌘−",
  scope: "terminal",
  match: (e) => cmdPressed(e) && !e.shiftKey && e.key === "-",
  run: () => {
    const cur = getSettingsState().settings.terminalFontSize;
    updateSettings({ terminalFontSize: Math.max(TERMINAL_FONT_SIZE_MIN, cur - 1) });
  },
});

registerCommand({
  id: "terminal.zoomReset",
  title: t("重置终端字号"),
  keybindingLabel: "⌘0",
  scope: "terminal",
  match: (e) => cmdPressed(e) && !e.shiftKey && e.key === "0",
  run: () => updateSettings({ terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT }),
});
