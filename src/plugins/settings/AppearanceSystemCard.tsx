/**
 * 基础设置 / 外观 tab 的系统外观段 —— 语言 / 界面缩放 / 终端字号 / 终端字体 / ANSI 色板。
 * 自 BasicAppearanceTab 拆出(300 行铁则);全部写 kernel/settings store 即时生效:
 * 语言 = 根组件重挂载,缩放 = kernel/uiZoom,字号字体 = TerminalView 订阅。
 */

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  UI_LANGUAGES,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
  updateSettings,
  useSettingsState,
  type UiLanguage,
} from "@kernel/settings";
import { LANGUAGE_LABELS, t } from "@kernel/i18n";
import {
  isTerminalFontAvailable,
  terminalFontOptionsForPlatform,
} from "@kernel/terminalFonts";

/** ANSI 色板槽位(token 名 = xterm ITheme 键的 kebab 形,值由 themeTokens 映射)。 */
const ANSI_TOKEN_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
] as const;

/** 终端 ANSI 16 色预览:直读文档计算样式(与幕布同源 token,主题切换后随重渲染刷新)。 */
function AnsiSwatchStrip() {
  const styles = getComputedStyle(document.documentElement);
  return (
    <div className="flex flex-wrap gap-1" aria-label={t("终端 ANSI 16 色")}>
      {ANSI_TOKEN_NAMES.map((slot) => {
        const color = styles.getPropertyValue(`--tmd-terminal-${slot}`).trim();
        return (
          <span
            key={slot}
            title={slot}
            className="h-4 w-4 rounded-sm border border-(--tmd-border)"
            style={{ background: color || "transparent" }}
          />
        );
      })}
    </div>
  );
}

export function SystemAppearanceCard() {
  const { settings } = useSettingsState();
  const fontOptions = terminalFontOptionsForPlatform();
  /* 下拉值:空 = 平台默认;命中候选 = 其 family;否则 = 自定义。 */
  const matchedFont = fontOptions.find((o) => o.family === settings.terminalFontFamily);
  const fontSelectValue = settings.terminalFontFamily === ""
    ? "auto"
    : (matchedFont?.family ?? "custom");

  return (
    <div className="pref-card" data-testid="settings-appearance-system-card">
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("语言")}</div>
          <div className="pref-desc">
            {t("界面文案语言;切换立即生效(整个界面重新加载,会话与数据不受影响)。")}
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("语言")}>
          {UI_LANGUAGES.map((id: UiLanguage) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.language === id}
              className={`segment${settings.language === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ language: id })}
            >
              {LANGUAGE_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("界面缩放")}</div>
          <div className="pref-desc">{t("整个界面等比缩放(80%–150%);终端文字大小另由下方字号单独控制。")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="range"
            min={UI_ZOOM_MIN}
            max={UI_ZOOM_MAX}
            step={UI_ZOOM_STEP}
            value={settings.uiZoom}
            aria-label={t("界面缩放")}
            onChange={(e) => updateSettings({ uiZoom: Number(e.target.value) })}
            className="w-40 accent-(--tmd-accent)"
          />
          <span className="w-10 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
            {Math.round(settings.uiZoom * 100)}%
          </span>
          {settings.uiZoom !== 1 ? (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
              onClick={() => updateSettings({ uiZoom: 1 })}
            >
              <ArrowCounterClockwise size={12} aria-hidden />
              {t("重置")}
            </button>
          ) : null}
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("终端字号")}</div>
          <div className="pref-desc">{t("幕布终端文字大小(10–20 px),拖动即时生效。")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="range"
            min={TERMINAL_FONT_SIZE_MIN}
            max={TERMINAL_FONT_SIZE_MAX}
            step={1}
            value={settings.terminalFontSize}
            aria-label={t("终端字号")}
            onChange={(e) => updateSettings({ terminalFontSize: Number(e.target.value) })}
            className="w-40 accent-(--tmd-accent)"
          />
          <span className="w-10 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
            {settings.terminalFontSize} px
          </span>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("终端字体")}</div>
          <div className="pref-desc">{t("等宽字体;未安装的字体置灰,可选「自定义」填 CSS family。")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={fontSelectValue}
            aria-label={t("终端字体")}
            onChange={(e) => {
              const v = e.target.value;
              updateSettings({
                terminalFontFamily:
                  v === "auto" ? "" : v === "custom" ? settings.terminalFontFamily || "monospace" : v,
              });
            }}
            className="w-48 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-sm text-(--tmd-fg) outline-none"
          >
            <option value="auto">{t("平台默认")}</option>
            {fontOptions.map((opt) => (
              <option key={opt.family} value={opt.family} disabled={!isTerminalFontAvailable(opt.family)}>
                {opt.label}
                {isTerminalFontAvailable(opt.family) ? "" : ` (${t("未安装")})`}
              </option>
            ))}
            <option value="custom">{t("自定义…")}</option>
          </select>
        </div>
      </div>
      {fontSelectValue === "custom" ? (
        <div className="pref-row">
          <div>
            <div className="pref-title">{t("自定义字体")}</div>
            <div className="pref-desc">{t("CSS font-family 串,如 'JetBrains Mono', 'Courier New'。")}</div>
          </div>
          <input
            type="text"
            defaultValue={settings.terminalFontFamily}
            placeholder="'JetBrains Mono', monospace"
            onBlur={(e) => updateSettings({ terminalFontFamily: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                updateSettings({ terminalFontFamily: (e.target as HTMLInputElement).value });
            }}
            className="w-64 shrink-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2 py-1 text-sm text-(--tmd-fg) outline-none"
          />
        </div>
      ) : null}
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("终端配色")}</div>
          <div className="pref-desc">{t("幕布终端 ANSI 16 色(随主题外观;浅色/深色各一套,默认采用 VS Code 官方终端配色)。")}</div>
        </div>
        <AnsiSwatchStrip />
      </div>
    </div>
  );
}
