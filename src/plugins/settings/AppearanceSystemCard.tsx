/**
 * 基础设置 / 外观 tab 的系统外观段 —— 语言 / 界面字号 / 界面缩放 / 终端字号 / 终端字体。
 * 自 BasicAppearanceTab 拆出(300 行铁则);全部写 kernel/settings store 即时生效:
 * 语言 = 根组件重挂载,字号 = kernel/uiFontSize,缩放 = kernel/uiZoom,终端字体字号 = TerminalView 订阅。
 */

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  UI_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_MAX,
  UI_FONT_SIZE_MIN,
  UI_LANGUAGES,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
  updateSettings,
  useSettingsState,
  type UiLanguage,
} from "@kernel/settings";
import { LANGUAGE_LABELS, t } from "@kernel/i18n";
import { StyledSelect } from "@kernel/StyledSelect";
import {
  isTerminalFontAvailable,
  terminalFontOptionsForPlatform,
} from "@kernel/terminalFonts";

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
          <div className="pref-title">{t("界面字号")}</div>
          <div className="pref-desc">{t("全客户端文字与图标大小(12–20 px);布局宽度不变,即时生效。")}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="range"
            min={UI_FONT_SIZE_MIN}
            max={UI_FONT_SIZE_MAX}
            step={1}
            value={settings.uiFontSize}
            aria-label={t("界面字号")}
            onChange={(e) => updateSettings({ uiFontSize: Number(e.target.value) })}
            className="w-40 accent-(--tmd-accent)"
          />
          <span className="w-10 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
            {settings.uiFontSize} px
          </span>
          {settings.uiFontSize !== UI_FONT_SIZE_DEFAULT ? (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg-muted) hover:text-(--tmd-fg)"
              onClick={() => updateSettings({ uiFontSize: UI_FONT_SIZE_DEFAULT })}
            >
              <ArrowCounterClockwise size="0.75rem" aria-hidden />
              {t("重置")}
            </button>
          ) : null}
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
              <ArrowCounterClockwise size="0.75rem" aria-hidden />
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
          <StyledSelect
            value={fontSelectValue}
            ariaLabel={t("终端字体")}
            className="w-48"
            onChange={(v) => {
              updateSettings({
                terminalFontFamily:
                  v === "auto" ? "" : v === "custom" ? settings.terminalFontFamily || "monospace" : v,
              });
            }}
            options={[
              { value: "auto", label: t("平台默认") },
              ...fontOptions.map((opt) => ({
                value: opt.family,
                label: opt.label,
                disabled: !isTerminalFontAvailable(opt.family),
                hint: isTerminalFontAvailable(opt.family) ? undefined : t("未安装"),
              })),
              { value: "custom", label: t("自定义…") },
            ]}
          />
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
    </div>
  );
}
