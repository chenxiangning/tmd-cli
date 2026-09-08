/**
 * 终端字体表 —— 平台默认栈 + 常见等宽字体清单(设置外观页与 TerminalView 共用)。
 * 可用性经 document.fonts.check 探测(系统本地字体按 family 名可用于 CSS);
 * 未安装项在下拉置灰而非隐藏,避免"列表神秘缩水"。
 */

import { getPlatformKind } from "./platform";

/** 平台默认等宽栈(与历史硬编码一致:mac Menlo 系 / win Cascadia 系 / linux DejaVu 系)。 */
const PLATFORM_MONO_STACKS: Record<"macos" | "windows" | "linux" | "unknown", string> = {
  macos: "Menlo, Monaco, 'Courier New', monospace",
  windows: "'Cascadia Mono', Consolas, 'Courier New', monospace",
  linux: "'DejaVu Sans Mono', 'Liberation Mono', monospace",
  unknown: "monospace",
};

/** 用户自定义 family 串优先;空 = 平台默认栈。 */
export function resolveTerminalFontFamily(custom: string): string {
  const trimmed = custom.trim();
  if (trimmed) return trimmed;
  return PLATFORM_MONO_STACKS[getPlatformKind()];
}

/** 下拉候选:label 展示名 / family 写入 settings 的 CSS 串 / platform 限定。 */
export interface TerminalFontOption {
  label: string;
  family: string;
  platforms?: ReadonlyArray<"macos" | "windows" | "linux">;
}

/** 常见等宽字体清单:平台专属在前,跨平台可装字体(JetBrains Mono 等)殿后。 */
export const TERMINAL_FONT_OPTIONS: readonly TerminalFontOption[] = [
  { label: "Menlo", family: "Menlo, monospace", platforms: ["macos"] },
  { label: "Monaco", family: "Monaco, monospace", platforms: ["macos"] },
  { label: "SF Mono", family: "'SF Mono', ui-monospace, monospace", platforms: ["macos"] },
  { label: "Cascadia Mono", family: "'Cascadia Mono', monospace", platforms: ["windows"] },
  { label: "Consolas", family: "Consolas, monospace", platforms: ["windows"] },
  { label: "DejaVu Sans Mono", family: "'DejaVu Sans Mono', monospace", platforms: ["linux"] },
  { label: "Liberation Mono", family: "'Liberation Mono', monospace", platforms: ["linux"] },
  { label: "Noto Sans Mono", family: "'Noto Sans Mono', monospace", platforms: ["linux"] },
  { label: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
  { label: "Fira Code", family: "'Fira Code', monospace" },
  { label: "Source Code Pro", family: "'Source Code Pro', monospace" },
  { label: "Iosevka", family: "Iosevka, monospace" },
  { label: "Hack", family: "Hack, monospace" },
];

/** 当前平台适用的候选(未限定 platforms 的跨平台项全保留)。 */
export function terminalFontOptionsForPlatform(): readonly TerminalFontOption[] {
  const kind = getPlatformKind();
  return TERMINAL_FONT_OPTIONS.filter(
    (opt) => !opt.platforms || opt.platforms.includes(kind as "macos" | "windows" | "linux"),
  );
}

/** 字体可用性探测:取 family 首名查 CSS 本地字体;环境不支持时返回 true(不置灰)。 */
export function isTerminalFontAvailable(family: string): boolean {
  const first = family.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (!first || first === "monospace" || first === "ui-monospace") return true;
  try {
    return document.fonts.check(`12px ${first}`);
  } catch {
    return true;
  }
}
