/**
 * 外观域设置类型与清洗 —— 语言/终端字体字号/界面缩放/界面字号(先例:sshSettings.ts 域文件)。
 * 承担:该域枚举白名单、合法域常量、sanitize 助手;字段装配在 settingsSanitize.ts。
 */

/** 界面语言:zh = 源中文(词典恒等);en/ja 走 kernel/i18n 词典,缺失回落源串。 */
export type UiLanguage = "zh" | "en" | "ja";
export const UI_LANGUAGES: readonly UiLanguage[] = ["zh", "en", "ja"];

/** 终端字号合法域(px);默认 13(与历史硬编码一致)。 */
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 20;
export const TERMINAL_FONT_SIZE_DEFAULT = 13;

/** 界面字号合法域(px,html 根字号);默认 16(浏览器基准,rem 体系锚点)。 */
export const UI_FONT_SIZE_MIN = 12;
export const UI_FONT_SIZE_MAX = 20;
export const UI_FONT_SIZE_DEFAULT = 16;

/** 界面缩放合法域与步进(0.8–1.5,5% 一档);默认 1。 */
export const UI_ZOOM_MIN = 0.8;
export const UI_ZOOM_MAX = 1.5;
export const UI_ZOOM_STEP = 0.05;
export const UI_ZOOM_DEFAULT = 1;

/** 终端字体 family 串长度上限(自定义输入兜底)。 */
const TERMINAL_FONT_FAMILY_MAX_LENGTH = 200;

/** 终端字号清洗:数值化 + 整数合法域,越界回落默认 13。 */
export function sanitizeTerminalFontSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= TERMINAL_FONT_SIZE_MIN && n <= TERMINAL_FONT_SIZE_MAX
    ? n
    : TERMINAL_FONT_SIZE_DEFAULT;
}

/** 界面字号清洗:数值化 + 整数合法域,越界回落默认 16。 */
export function sanitizeUiFontSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n >= UI_FONT_SIZE_MIN && n <= UI_FONT_SIZE_MAX
    ? n
    : UI_FONT_SIZE_DEFAULT;
}

/** 字体串清洗:trim + 去 C0 控制字符 + 截断(不做格式校验,xterm 自行回落系统字体)。 */
export function sanitizeTerminalFontFamily(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f]/g, "").trim().slice(0, TERMINAL_FONT_FAMILY_MAX_LENGTH);
}

/** 缩放清洗:数值化 → 取 5% 档(消除浮点残渣)→ 越界回落 1。 */
export function sanitizeUiZoom(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return UI_ZOOM_DEFAULT;
  const stepped = Math.round(n / UI_ZOOM_STEP) * UI_ZOOM_STEP;
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(stepped * 100) / 100));
}