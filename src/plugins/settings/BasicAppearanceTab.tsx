/**
 * 基础设置 / 外观 tab —— 主题模式 + 自定义 preset 网格。
 *
 * 交互对齐 codemoss BasicAppearanceSection 的主题段:
 * segmented(跟随系统/浅色/深色/自定义) + 自定义时展开 21 preset 网格。
 * 全部写入 kernel/settings store,主题引擎即时生效,无需「保存」按钮。
 */

import { Check, Monitor, Moon, Palette, Sun } from "lucide-react";
import {
  updateSettings,
  useSettingsState,
  type ThemePreference,
} from "@kernel/settings";
import {
  getAllThemePresets,
  type ThemePresetDefinition,
} from "@kernel/themePresets";
import { resolveEffectiveAppearance } from "@kernel/theme";
import { mixHexColors, normalizeHexColor, withAlpha } from "@kernel/themeTokens";

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
    appearance === "light" ? "浅色" : "深色";
  /* hint 里的外观词必须是「当前实际生效外观」:system → matchMedia 解析结果。 */
  const resolved = resolveEffectiveAppearance(
    settings,
    window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );

  const themeHint =
    settings.theme === "system"
      ? `当前跟随系统使用 ${appearanceLabel(resolved)} 外观。`
      : settings.theme === "custom"
        ? `当前使用自定义主题(${activePreset.label},${appearanceLabel(resolved)})。`
        : `当前固定使用 ${appearanceLabel(resolved)} 外观。`;

  return (
    <div
      className={`pref-card${settings.theme === "custom" ? " is-custom" : ""}`}
      data-testid="settings-theme-card"
    >
      <div className="pref-row">
        <div>
          <div className="pref-title">会话标题 tab 条</div>
          <div className="pref-desc">
            顶栏中央同时展示最多 4 个已打开的会话,点击切换;关闭后仍可从左侧栏进入会话。
          </div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="会话标题 tab 条">
          <button
            type="button"
            role="radio"
            aria-checked={settings.sessionTabsEnabled}
            className={`segment${settings.sessionTabsEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sessionTabsEnabled: true })}
          >
            开启
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!settings.sessionTabsEnabled}
            className={`segment${!settings.sessionTabsEnabled ? " is-active" : ""}`}
            onClick={() => updateSettings({ sessionTabsEnabled: false })}
          >
            关闭
          </button>
        </div>
      </div>
      <div className="pref-row">
        <div>
          <div className="pref-title">主题</div>
          <div className="pref-desc">{themeHint}</div>
        </div>
        <div className="segmented" role="radiogroup" aria-label="主题">
          {THEME_MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.theme === id}
              className={`segment${settings.theme === id ? " is-active" : ""}`}
              onClick={() => updateSettings({ theme: id })}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="preset-section">
        {(["light", "dark"] as const).map((appearance) => (
          <div key={appearance}>
            <div className="preset-group-label">
              {appearance === "light" ? "浅色主题" : "深色主题"}
            </div>
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
                      <Check className="preset-check" size={13} aria-hidden />
                    </span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
