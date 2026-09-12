// 插件市场清单列表视图(按分类分节的卡片网格),自 PluginMarketPage.tsx 按「纯结构拆分、行为不变」拆出
import type { PluginCategory } from "@kernel/plugin";
import { t } from "@kernel/i18n";
import { CATEGORY_LABEL } from "./pluginMarketCategories";
import type { Row } from "./PluginMarketStrip";

/** 清单列表:与插排视图互斥,同页只展示一份。 */
export function PluginMarketList({
  groups,
  onToggle,
}: {
  groups: { category: PluginCategory; rows: Row[] }[];
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.category}>
          <div className="pm-section-title">
            {t(CATEGORY_LABEL[g.category])}
            <span className="pm-count">
              {t("{on}/{total} 已插入", { on: g.rows.filter((r) => r.on).length, total: g.rows.length })}
            </span>
          </div>
          <div className="pm-card-grid">
            {g.rows.map(({ plugin, on, dirty }) => {
              const core = plugin.meta.category === "core";
              const Icon = plugin.meta.icon;
              return (
                <div key={plugin.id} className={`pm-card${on ? "" : " is-out"}`}>
                  <div
                    className="pm-card-icon"
                    style={plugin.meta.iconColor ? { color: plugin.meta.iconColor } : undefined}
                  >
                    {Icon ? <Icon size="0.9375rem" /> : plugin.meta.abbr}
                  </div>
                  <div className="pm-card-main">
                    <div className="pm-card-name">
                      {t(plugin.meta.name)}
                      <span className="pm-card-id">{plugin.id}</span>
                    </div>
                    <div className="pm-card-desc">{t(plugin.meta.desc)}</div>
                    <div className="pm-card-foot">
                      {core ? <span className="pm-badge core">{t("核心 · 焊死")}</span> : null}
                      {dirty ? <span className="pm-badge dirty">{t("重启后生效")}</span> : null}
                      <button
                        type="button"
                        className={`pm-toggle-btn${on ? " on" : ""}`}
                        disabled={core}
                        onClick={() => onToggle(plugin.id)}
                      >
                        {core ? t("常插") : on ? t("拔出") : t("插入")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
