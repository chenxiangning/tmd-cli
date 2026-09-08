/**
 * VS Code light 主题 preset 数据 —— 2026-09-08 浅色扩充批(勿手改,说明见 ./index.ts)。
 * 源:各主题官方仓库一手 json / Kanagawa 官方色板 / One Half·Tomorrow·Xcode 经典色板;
 * terminal.ansi* 按浅底可读适配(16 槽对 terminal 背景 WCAG 对比度 ≥3:1,详见 spec)。
 */
import type { ThemePresetDefinition, ThemePresetId } from "./index";

export const LIGHT_PRESETS_PART7 = {
  "vscode-noctis-lux": {
    "id": "vscode-noctis-lux",
    "appearance": "light",
    "label": "Noctis Lux",
    "colors": {
      "foreground": "#005661",
      "descriptionForeground": "#929ea0",
      "editor.background": "#fef8ec",
      "editor.foreground": "#005661",
      "sideBar.background": "#f9f1e1",
      "sideBar.foreground": "#888477",
      "panel.background": "#f6edda",
      "panel.border": "#00c6e0",
      "input.background": "#fef8ec",
      "input.foreground": "#6a7a7c",
      "input.border": "#f2edde",
      "button.background": "#009999",
      "button.foreground": "#f1f1f1",
      "dropdown.background": "#fef8ec",
      "dropdown.border": "#fef8ec",
      "editorWidget.background": "#f2edde",
      "list.hoverBackground": "#d2f3f9",
      "list.activeSelectionBackground": "#b6e1e7",
      "list.activeSelectionForeground": "#005661",
      "activityBar.background": "#fef8ec",
      "activityBar.foreground": "#0099ad",
      "statusBar.background": "#f0e9d6",
      "statusBar.foreground": "#0099ad",
      "titleBar.activeBackground": "#f9f1e1",
      "titleBar.activeForeground": "#005661",
      "terminal.background": "#f6edda",
      "terminal.foreground": "#005661",
      "terminalCursor.foreground": "#005661",
      "editorLineNumber.foreground": "#a0abac",
      "editorGutter.addedBackground": "#8ce99a",
      "editorGutter.modifiedBackground": "#e9a149",
      "editorGutter.deletedBackground": "#ff4000",
      "textLink.foreground": "#00c6e0",
      "badge.background": "#0099ad",
      "badge.foreground": "#fef8ec",
      "terminal.ansiBlack": "#003b42",
      "terminal.ansiRed": "#e34e1c",
      "terminal.ansiGreen": "#009858",
      "terminal.ansiYellow": "#be761d",
      "terminal.ansiBlue": "#0088dd",
      "terminal.ansiMagenta": "#d84a7b",
      "terminal.ansiCyan": "#0093a7",
      "terminal.ansiWhite": "#778d8d",
      "terminal.ansiBrightBlack": "#004d57",
      "terminal.ansiBrightRed": "#ff4000",
      "terminal.ansiBrightGreen": "#009657",
      "terminal.ansiBrightYellow": "#c76d00",
      "terminal.ansiBrightBlue": "#0d8ad8",
      "terminal.ansiBrightMagenta": "#d85a86",
      "terminal.ansiBrightCyan": "#0091a5",
      "terminal.ansiBrightWhite": "#7a8182",
      "button.secondaryBackground": "#e2e1d0",
      "button.secondaryForeground": "#005661",
      "terminal.selectionBackground": "#b6e1e7"
    },
    "syntax": {
      "keyword": "#ff5792",
      "string": "#00b368",
      "comment": "#8ca6a6",
      "number": "#5842ff",
      "function": "#0095a8",
      "operator": "#004d57",
      "type": "#b3694d",
      "tag": "#e64100"
    },
    "diff": {
      "inserted": "#009456",
      "removed": "#ff4000"
    }
  }
} as unknown as Record<ThemePresetId, Omit<ThemePresetDefinition, "id">>;
