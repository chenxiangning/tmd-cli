/**
 * 主题 token 映射器 —— preset colors → `--tmd-*` CSS 变量。
 *
 * 映射算法移植自 codemoss features/theme/utils/mapVsCodeColorsToTokens.ts,
 * 输出目标从 codemoss 语义 token 改为 tmd-cli design tokens
 * (~/.claude/projects/-Users-chenxiangning-code-AI-github-tmd-cli/design/design-tokens.md)。
 * 颜色工具自包含:kernel 不依赖任何 utils 层。
 */

import type { DiffTokens, SyntaxTokens, ThemePresetDefinition } from "./themePresets";

/** `--tmd-*` 变量名 → 颜色值。 */
export type ThemeCssVariableMap = Record<`--tmd-${string}`, string>;

// ── 颜色工具(与 codemoss utils/colorUtils 同算法) ──────────────────────────

/** 归一化 #rgb/#rrggbb → 小写 #rrggbb;非法输入返回 null。 */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex) ?? "#000000";
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function channelToHex(v: number): string {
  return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
}

/** 线性混合两个颜色,t ∈ [0,1] 为 b 的权重。 */
export function mixHexColors(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return `#${channelToHex(r1 + (r2 - r1) * t)}${channelToHex(g1 + (g2 - g1) * t)}${channelToHex(b1 + (b2 - b1) * t)}`;
}

/** 颜色 + alpha → rgba() 字符串。 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 给定底色上取黑/白对比文字色(相对亮度阈值 0.5)。 */
export function getContrastingTextColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#1f1f1f" : "#ffffff";
}

// ── preset → tokens ─────────────────────────────────────────────────────────

/** preset 缺 syntax/diff 段时的兜底(对齐 github 系配色的阅读惯例)。 */
const FALLBACK_SYNTAX: Record<"light" | "dark", SyntaxTokens> = {
  light: {
    keyword: "#2f6fdd",
    string: "#116329",
    comment: "#57606e",
    number: "#b06b00",
    function: "#6a46c7",
    operator: "#343d4c",
    type: "#cf222e",
    tag: "#cf222e",
  },
  dark: {
    keyword: "#8bd5ff",
    string: "#7ee787",
    comment: "#96aac8",
    number: "#f2cc60",
    function: "#d2a8ff",
    operator: "#c8d2dc",
    type: "#ff7b72",
    tag: "#ff7b72",
  },
};

const FALLBACK_DIFF: Record<"light" | "dark", DiffTokens> = {
  light: { inserted: "#1a7f37", removed: "#cf222e" },
  dark: { inserted: "#2ea043", removed: "#f85149" },
};

function getColor(
  colors: Record<string, string>,
  key: string,
  fallback: string,
): string {
  return normalizeHexColor(colors[key]) ?? fallback;
}

/**
 * 单个 preset → 全量 `--tmd-*` 变量表。
 * 缺色时按 VS Code 语义链兜底(同 codemoss),保证任何残缺 preset 也能产出完整 token 集。
 */
export function mapPresetToTokens(preset: ThemePresetDefinition): ThemeCssVariableMap {
  const { appearance, colors } = preset;
  const isDark = appearance === "dark";

  const bgBase = getColor(colors, "editor.background", isDark ? "#1e1e1e" : "#ffffff");
  const fg = getColor(
    colors,
    "foreground",
    getColor(colors, "editor.foreground", isDark ? "#d4d4d4" : "#1f1f1f"),
  );
  const bgElevated = getColor(
    colors,
    "sideBar.background",
    mixHexColors(bgBase, isDark ? "#000000" : "#ffffff", isDark ? 0.12 : 0.04),
  );
  const bgSunken = getColor(
    colors,
    "titleBar.activeBackground",
    getColor(colors, "statusBar.background", bgElevated),
  );
  const panelBackground = getColor(colors, "panel.background", bgElevated);
  const border = getColor(
    colors,
    "input.border",
    getColor(
      colors,
      "dropdown.border",
      getColor(colors, "panel.border", mixHexColors(panelBackground, fg, isDark ? 0.16 : 0.14)),
    ),
  );
  const accent = getColor(
    colors,
    "button.background",
    getColor(colors, "textLink.foreground", isDark ? "#007acc" : "#005fb8"),
  );

  const syntax = { ...FALLBACK_SYNTAX[appearance], ...preset.syntax };
  const diff = { ...FALLBACK_DIFF[appearance], ...preset.diff };

  return {
    // 表面
    "--tmd-bg-base": bgBase,
    "--tmd-bg-elevated": bgElevated,
    "--tmd-bg-sunken": bgSunken,
    "--tmd-bg-hover": getColor(
      colors,
      "list.hoverBackground",
      mixHexColors(panelBackground, isDark ? "#ffffff" : "#000000", isDark ? 0.06 : 0.04),
    ),
    "--tmd-bg-active": withAlpha(accent, isDark ? 0.24 : 0.14),
    "--tmd-bg-input": getColor(
      colors,
      "input.background",
      getColor(colors, "dropdown.background", panelBackground),
    ),
    "--tmd-bg-popover": getColor(
      colors,
      "dropdown.background",
      getColor(colors, "editorWidget.background", panelBackground),
    ),
    // 文字
    "--tmd-fg": fg,
    "--tmd-fg-muted": mixHexColors(fg, bgBase, 0.34),
    "--tmd-fg-subtle": mixHexColors(fg, bgBase, 0.48),
    "--tmd-fg-faint": mixHexColors(fg, bgBase, 0.68),
    // 边框
    "--tmd-border": border,
    "--tmd-border-strong": mixHexColors(border, fg, 0.2),
    // 强调
    "--tmd-accent": accent,
    "--tmd-accent-fg": getColor(colors, "button.foreground", getContrastingTextColor(accent)),
    "--tmd-accent-soft": withAlpha(accent, isDark ? 0.24 : 0.14),
    // 语法高亮(CodeMirror / Prism 消费)
    "--tmd-syntax-keyword": normalizeHexColor(syntax.keyword) ?? FALLBACK_SYNTAX[appearance].keyword,
    "--tmd-syntax-string": normalizeHexColor(syntax.string) ?? FALLBACK_SYNTAX[appearance].string,
    "--tmd-syntax-comment": normalizeHexColor(syntax.comment) ?? FALLBACK_SYNTAX[appearance].comment,
    "--tmd-syntax-number": normalizeHexColor(syntax.number) ?? FALLBACK_SYNTAX[appearance].number,
    "--tmd-syntax-function": normalizeHexColor(syntax.function) ?? FALLBACK_SYNTAX[appearance].function,
    "--tmd-syntax-operator": normalizeHexColor(syntax.operator) ?? FALLBACK_SYNTAX[appearance].operator,
    "--tmd-syntax-type": normalizeHexColor(syntax.type) ?? FALLBACK_SYNTAX[appearance].type,
    "--tmd-syntax-tag": normalizeHexColor(syntax.tag) ?? FALLBACK_SYNTAX[appearance].tag,
    // diff(文件树/git 面板消费)
    "--tmd-diff-inserted": diff.inserted,
    "--tmd-diff-removed": diff.removed,
    /* git 状态字符 M(修改)专用琥珀;A/D 复用 diff-inserted/removed,U 用 fg-faint。 */
    "--tmd-git-modified": getColor(colors, "editorWarning.foreground", isDark ? "#e5c07b" : "#b7791f"),
    // 幕布终端(xterm 消费,kernel/TerminalView 读计算样式应用)
    "--tmd-terminal-bg": getColor(colors, "terminal.background", bgBase),
    "--tmd-terminal-fg": getColor(
      colors,
      "terminal.foreground",
      getColor(colors, "editor.foreground", fg),
    ),
    "--tmd-terminal-cursor": getColor(
      colors,
      "terminalCursor.foreground",
      getColor(colors, "editor.foreground", fg),
    ),
    "--tmd-terminal-selection":
      normalizeHexColor(colors["terminal.selectionBackground"]) ??
      withAlpha(accent, isDark ? 0.32 : 0.2),
  };
}

/** 映射器输出的全部变量名(主题引擎用它做切换前清理)。 */
export const THEME_CSS_VARIABLE_KEYS = Object.keys(
  mapPresetToTokens({
    id: "vscode-dark-modern",
    appearance: "dark",
    label: "",
    colors: {},
  }),
) as readonly `--tmd-${string}`[];
