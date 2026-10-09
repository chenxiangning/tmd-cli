/**
 * 基础设置 / 外观 tab 的图标装饰卡 —— 顶部「图标组合」五套切换 + 名称检索,
 * 清单按界面域六组展示(通用/右栏面板/侧栏工作区/输入框/Git/文件树),
 * 逐图标取色与呼吸闪烁。清单与分组是纯 UI 知识,在 iconDecorItems.tsx。
 */
import { useState } from "react";
import { ArrowCounterClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import {
  DEFAULT_ICON_DECOR,
  updateSettings,
  useSettingsState,
  type IconDecorId,
  type IconDecorItem,
} from "@kernel/settings";
import { DecorIcon } from "@kernel/iconSet";
import { t } from "@kernel/i18n";
import { COLOR_PLACEHOLDER, ICON_DECOR_GROUPS, ICON_DECOR_ITEMS, ICON_SETS } from "./iconDecorItems";

export function IconDecorCard() {
  const { settings } = useSettingsState();
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  const setItem = (id: IconDecorId, patch: Partial<IconDecorItem>) => {
    updateSettings({
      iconDecor: { ...settings.iconDecor, [id]: { ...settings.iconDecor[id], ...patch } },
    });
  };
  /** 恢复出厂 = 清自定义色 + blink 回出厂(newchat 回到默认开)。 */
  const resetItem = (id: IconDecorId) => {
    updateSettings({
      iconDecor: { ...settings.iconDecor, [id]: { ...DEFAULT_ICON_DECOR[id] } },
    });
  };

  /* 检索:命中译名或 id,大小写不敏感;无命中的组整组隐藏。 */
  const needle = query.trim().toLowerCase();
  const visibleGroups = ICON_DECOR_GROUPS.map(({ id, label }) => ({
    id,
    label,
    items: ICON_DECOR_ITEMS.filter(
      ({ id: itemId, label: itemLabel, group }) =>
        group === id &&
        (needle === "" || t(itemLabel).toLowerCase().includes(needle) || itemId.includes(needle)),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="pref-card" data-testid="settings-icon-decor-card">
      <button
        type="button"
        className="preset-group-label"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <CaretRight size="0.75rem" aria-hidden /> : <CaretDown size="0.75rem" aria-hidden />}
        {t("图标装饰")}
      </button>
      {!collapsed && (
        <>
          <div className="pref-desc">
            {t("逐图标自定义颜色与呼吸闪烁;面板/侧栏两态图标仅作用于点亮色,其余整图标着色。")}
          </div>
          <div className="pref-row icon-decor-row">
            <div className="icon-decor-id">
              <span className="pref-title">{t("图标组合")}</span>
            </div>
            <div className="segmented" role="radiogroup" aria-label={t("图标组合")}>
              {ICON_SETS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={settings.iconSet === id}
                  className={`segment${settings.iconSet === id ? " is-active" : ""}`}
                  onClick={() => updateSettings({ iconSet: id })}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>
          <div className="pref-row icon-decor-row">
            <div className="icon-decor-id">
              <span className="pref-title">{t("检索图标")}</span>
            </div>
            <input
              type="text"
              className="h-7 w-full min-w-0 rounded-md border border-(--tmd-border) bg-(--tmd-bg-input) px-2.5 text-xs text-(--tmd-fg) outline-none placeholder:text-(--tmd-fg-faint) focus:border-(--tmd-accent)"
              value={query}
              placeholder={t("按名称或 id 筛选…")}
              aria-label={t("检索图标")}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {visibleGroups.map(({ id, label, items }) => (
            <div key={id} className="icon-decor-group">
              <div className="icon-decor-group-label">{t(label)}</div>
              <div className="icon-decor-grid">
                {items.map(({ id: itemId, label: itemLabel, icon: Icon }) => {
                  const item = settings.iconDecor[itemId];
                  const isDefault =
                    !item.color &&
                    (item.blink ?? false) === (DEFAULT_ICON_DECOR[itemId].blink ?? false);
                  return (
                    <div className="pref-row icon-decor-row" key={itemId}>
                      <div className="icon-decor-id">
                        <span
                          className="icon-decor-preview"
                          style={item.color ? { color: item.color } : undefined}
                        >
                          <DecorIcon id={itemId} Fallback={Icon} size="0.875rem" />
                        </span>
                        <span className="pref-title">{t(itemLabel)}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <input
                          type="color"
                          className="icon-decor-color"
                          value={item.color ?? COLOR_PLACEHOLDER}
                          aria-label={`${t(itemLabel)} ${t("颜色")}`}
                          onChange={(e) => setItem(itemId, { color: e.target.value })}
                        />
                        <div
                          className="segmented"
                          role="radiogroup"
                          aria-label={`${t(itemLabel)} ${t("闪烁")}`}
                        >
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!!item.blink}
                            className={`segment${item.blink ? " is-active" : ""}`}
                            onClick={() => setItem(itemId, { blink: true })}
                          >
                            {t("开启")}
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={!item.blink}
                            className={`segment${!item.blink ? " is-active" : ""}`}
                            onClick={() => setItem(itemId, { blink: false })}
                          >
                            {t("关闭")}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="icon-decor-reset"
                          disabled={isDefault}
                          title={t("恢复默认")}
                          aria-label={`${t(itemLabel)} ${t("恢复默认")}`}
                          onClick={() => resetItem(itemId)}
                        >
                          <ArrowCounterClockwise size="0.875rem" aria-hidden />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {visibleGroups.length === 0 && (
            <div className="pref-desc">{t("没有匹配的图标,换个关键词试试。")}</div>
          )}
        </>
      )}
    </div>
  );
}
