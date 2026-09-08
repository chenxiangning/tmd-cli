/**
 * 基础设置 / 外观 tab —— 主题模式 + 自定义 preset 网格。
 *
 * 交互对齐 codemoss BasicAppearanceSection 的主题段:
 * segmented(跟随系统/浅色/深色/自定义) + 自定义时展开 21 preset 网格。
 * 全部写入 kernel/settings store,主题引擎即时生效,无需「保存」按钮。
 */

import { useState } from "react";
import { CaretDown, CaretRight, Check, Monitor, Moon, Palette, Sun } from "@phosphor-icons/react";
import {
  SESSION_TABS_LIMIT_MAX,
  SESSION_TABS_LIMIT_MIN,
  updateSettings,
  useSettingsState,
  type ThemePreference,
} from "@kernel/settings";
import { t } from "@kernel/i18n";
import {
  getAllThemePresets,
  type ThemePresetDefinition,
} from "@kernel/themePresets";
import { resolveEffectiveAppearance } from "@kernel/theme";
import { mixHexColors, normalizeHexColor, withAlpha } from "@kernel/themeTokens";
import { SystemAppearanceCard } from "./AppearanceSystemCard";
const THEME_MODES: ReadonlyArray<{
  id: ThemePreference;
  label: string;
  icon: typeof Monitor;
}> = [
  { id: "system", label: "跟随系统", icon: Monitor },
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
  { id: "custom", label: "自定义", icon: Palette },
];

/** preset 缩略图:侧栏条 + 编辑器底色 + 前景/强调色条,直接吃 preset colors。 */
function PresetThumb({ preset }: { preset: ThemePresetDefinition }) {
  const { colors } = preset;
  const side = normalizeHexColor(colors["sideBar.background"]) ?? "#888888";
  const main = normalizeHexColor(colors["editor.background"]) ?? "#888888";
  const accent = normalizeHexColor(colors["button.background"]) ?? "#007acc";
  const fg = normalizeHexColor(colors["editor.foreground"]) ?? "#cccccc";
  return (
    <div className="preset-thumb" style={{ background: main }}>
      <div className="preset-thumb-side" style={{ background: side }}>
        <span style={{ background: withAlpha(accent, 0.35) }} />
        <span />
      </div>
      <div className="preset-thumb-main">
        <i style={{ background: fg, width: "55%" }} />
        <i style={{ background: accent, width: "35%" }} />
        <i style={{ background: mixHexColors(fg, main, 0.5), width: "70%" }} />
      </div>
    </div>
  );
}

export function BasicAppearanceTab() {
  const { settings } = useSettingsState();
  const presets = getAllThemePresets();
  const activePreset = presets.find((p) => p.id === settings.customThemePresetId) ?? presets[0];
  const appearanceLabel = (appearance: "light" | "dark") =>
    t(appearance === "light" ? "浅色" : "深色");
  /* 分组折叠态(浅色/深色),会话局部,默认全展开 */
  const [collapsedGroups, setCollapsedGroups] = useState<{ light: boolean; dark: boolean }>({
    light: false,
    dark: false,
  });
  /* hint 里的外观词必须是「当前实际生效外观」:system → matchMedia 解析结果。 */
  const resolved = resolveEffectiveAppearance(
    settings,
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const themeHint =
    settings.theme === "system"
      ? t("当前跟随系统使用 {appearance} 外观。", { appearance: appearanceLabel(resolved) })
      : settings.theme === "custom"
        ? t("当前使用自定义主题({preset},{appearance})。", {
            preset: activePreset.label,
            appearance: appearanceLabel(resolved),
          })
        : t("当前固定使用 {appearance} 外观。", { appearance: appearanceLabel(resolved) });

  return (
    <>
    <div
      className={`pref-card${settings.theme === "custom" ? " is-custom" : ""}`}
      data-testid="settings-theme-card"
    >
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("会话标题 tab 条")}</div>
          <div className="pref-desc">
            {t("顶栏中央展示已打开的会话，点击切换；关闭后仍可从左侧栏进入会话。")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {settings.sessionTabsEnabled ? (
            <>
              <input
                type="range"
                min={SESSION_TABS_LIMIT_MIN}
                max={SESSION_TABS_LIMIT_MAX}
                step={1}
                value={settings.sessionTabsMax}
                aria-label={t("会话标题 tab 条容量")}
                onChange={(e) => updateSettings({ sessionTabsMax: Number(e.target.value) })}
                className="w-28 accent-(--tmd-accent)"
              />
              <span className="w-4 text-right text-sm tabular-nums text-(--tmd-fg-muted)">
                {settings.sessionTabsMax}
              </span>
            </>
          ) : null}
          <div className="segmented" role="radiogroup" aria-label={t("会话标题 tab 条")}>
            <button
              type="button"
              role="radio"
              aria-checked={settings.sessionTabsEnabled}
              className={`segment${settings.sessionTabsEnabled ? " is-active" : ""}`}
              onClick={() => updateSettings({ sessionTabsEnabled: true })}
            >
              {t("开启")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!settings.sessionTabsEnabled}
              className={`segment${!settings.sessionTabsEnabled ? " is-active" : ""}`}
              onClick={() => updateSettings({ sessionTabsEnabled: false })}
            >
              {t("关闭")}
            </button>
          </div>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">{t("主题")}</div>
          <div className="pref-desc">{themeHint}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label={t("主题")}>
          {THEME_MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.theme === id}
              className={`segment${settings.theme === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ theme: id })}
            >
              <Icon size="0.8125rem" aria-hidden />
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      <div className="preset-section">
        {(["light", "dark"] as const).map((appearance) => (
          <div key={appearance}>
            <button
              type="button"
              className="preset-group-label"
              aria-expanded={!collapsedGroups[appearance]}
              onClick={() =>
                setCollapsedGroups((c) => ({ ...c, [appearance]: !c[appearance] }))
              }
            >
              {collapsedGroups[appearance] ? (
                <CaretRight size="0.75rem" aria-hidden />
              ) : (
                <CaretDown size="0.75rem" aria-hidden />
              )}
              {appearance === "light" ? t("浅色主题") : t("深色主题")}
            </button>
            {!collapsedGroups[appearance] && (
            <div className="preset-grid">
              {presets
                .filter((p) => p.appearance === appearance)
                .map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preset-card${preset.id === settings.customThemePresetId ? " is-active" : ""}`}
                    onClick={() =>
                      updateSettings({
                        theme: "custom",
                        customThemePresetId: preset.id,
                      })
                    }
                  >
                    <PresetThumb preset={preset} />
                    <span className="preset-name">
                      {preset.label}
                      <Check className="preset-check" size="0.8125rem" aria-hidden />
                    </span>
                  </button>
                ))}
            </div>
            )}
          </div>
        ))}
      </div>
    </div>
    <SystemAppearanceCard />
    </>
  );
}
