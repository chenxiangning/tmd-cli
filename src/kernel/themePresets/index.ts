/**
 * VS Code 主题 preset 目录 —— 移植自 codemoss features/theme/constants/vscodeThemePresets.ts。
 *
 * 数据结构 = codemoss 原版(VsCodeThemeColors 键名即 VS Code workbench.colorCustomizations 键)。
 * label 已内联中文环境展示名;映射到 --tmd-* token 见 kernel/themeTokens.ts。
 * 本文件由源数据程序化生成,新增 preset 应回源 codemoss 同步,勿手改。
 */import { DARK_PRESETS } from "./dark";
import { LIGHT_PRESETS } from "./light";

export type ThemeAppearance = "light" | "dark";

export type ThemePresetId =
  | "vscode-dark-modern"
  | "vscode-dark-plus"
  | "vscode-light-modern"
  | "vscode-light-plus"
  | "vscode-github-light"
  | "vscode-solarized-light"
  | "vscode-catppuccin-latte"
  | "vscode-tokyo-day"
  | "vscode-rose-pine-dawn"
  | "vscode-everforest-light"
  | "vscode-ayu-light"
  | "vscode-github-dark"
  | "vscode-github-dark-dimmed"
  | "vscode-one-dark-pro"
  | "vscode-monokai"
  | "vscode-solarized-dark"
  | "vscode-dracula"
  | "vscode-nord"
  | "vscode-catppuccin-mocha"
  | "vscode-tokyo-night"
  | "vscode-rose-pine";

type VsCodeThemeColors = Record<string, string>;

export interface SyntaxTokens {
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  operator: string;
  type: string;
  tag: string;
}

export interface DiffTokens {
  inserted: string;
  removed: string;
}

export interface ThemePresetDefinition {
  id: ThemePresetId;
  appearance: ThemeAppearance;
  /** 中文环境展示名(codemoss i18n zh label 内联)。 */
  label: string;
  colors: VsCodeThemeColors;
  syntax?: Partial<SyntaxTokens>;
  diff?: Partial<DiffTokens>;
}

export const DEFAULT_LIGHT_THEME_PRESET_ID: ThemePresetId = "vscode-light-modern";
export const DEFAULT_DARK_THEME_PRESET_ID: ThemePresetId = "vscode-dark-modern";

export const LIGHT_THEME_PRESET_IDS = [
  "vscode-light-modern",
  "vscode-light-plus",
  "vscode-github-light",
  "vscode-solarized-light",
  "vscode-catppuccin-latte",
  "vscode-tokyo-day",
  "vscode-rose-pine-dawn",
  "vscode-everforest-light",
  "vscode-ayu-light"
] as const satisfies readonly ThemePresetId[];

export const DARK_THEME_PRESET_IDS = [
  "vscode-dark-modern",
  "vscode-dark-plus",
  "vscode-github-dark",
  "vscode-github-dark-dimmed",
  "vscode-one-dark-pro",
  "vscode-monokai",
  "vscode-solarized-dark",
  "vscode-dracula",
  "vscode-nord",
  "vscode-catppuccin-mocha",
  "vscode-tokyo-night",
  "vscode-rose-pine"
] as const satisfies readonly ThemePresetId[];

export const ALL_THEME_PRESET_IDS: readonly ThemePresetId[] = [
  ...LIGHT_THEME_PRESET_IDS,
  ...DARK_THEME_PRESET_IDS,
];

const PRESETS = {
  ...LIGHT_PRESETS,
  ...DARK_PRESETS,
};

export function getThemePreset(id: ThemePresetId): ThemePresetDefinition {
  return { id, ...PRESETS[id] };
}

export function isThemePresetId(value: string | null | undefined): value is ThemePresetId {
  return typeof value === "string" && value in PRESETS;
}

export function getAllThemePresets(): ThemePresetDefinition[] {
  return ALL_THEME_PRESET_IDS.map(getThemePreset);
}
