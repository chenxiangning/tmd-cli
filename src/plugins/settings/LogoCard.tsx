/**
 * 基础设置 / 外观 tab 的应用 Logo 卡 —— 品牌图标九款网格切换,
 * 清单在 kernel/appLogo.ts,写 settings.appLogo 即时生效(无保存按钮)。
 */
import { useState } from "react";
import { CaretDown, CaretRight, Check } from "@phosphor-icons/react";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { APP_LOGOS } from "@kernel/appLogo";
import { t } from "@kernel/i18n";

export function LogoCard() {
  const { settings } = useSettingsState();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="pref-card" data-testid="settings-logo-card">
      <button
        type="button"
        className="preset-group-label"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <CaretRight size="0.75rem" aria-hidden /> : <CaretDown size="0.75rem" aria-hidden />}
        {t("应用 Logo")}
      </button>
      {!collapsed && (
        <>
          <div className="pref-desc">
            {t("侧栏设置钮等品牌位的应用图标,选中即时生效。")}
          </div>
          <div className="logo-grid" role="radiogroup" aria-label={t("应用 Logo")}>
            {APP_LOGOS.map(({ id, label, url }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={settings.appLogo === id}
                className={`logo-card${settings.appLogo === id ? " is-active" : ""}`}
                onClick={() => updateSettings({ appLogo: id })}
              >
                <img src={url} alt="" className="logo-thumb" draggable={false} />
                <span className="logo-name">
                  {t(label)}
                  <Check className="preset-check" size="0.875rem" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
