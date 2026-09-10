// 插件市场插排视图(插座单元 + 合并大插排),自 PluginMarketPage.tsx 按「纯结构拆分、行为不变」拆出
import type { ComponentType } from "react";
import { Lock } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { getMarketPanel } from "@kernel/marketPanel";
import type { Plugin, PluginCategory } from "@kernel/plugin";
import { CATEGORY_LABEL } from "./pluginMarketCategories";

/** 插排品牌区文案;缺省 = tmd-cli 主插排。 */
export interface StripBrand {
  name: string;
  role: string;
  master: string;
}

/** 合并大插排:品牌区 + 各分类分区(虚线分隔 + 区内小标签)。 */
export function MergedStrip({
  groups,
  onToggle,
  onOpenMarket,
  brand,
  count,
}: {
  groups: { category: PluginCategory; rows: Row[] }[];
  onToggle: (id: string) => void;
  /** 二级市场开合(无注册面板的插头不渲染角标)。 */
  onOpenMarket?: (id: string) => void;
  /** 本机插件等次级插排传入独立品牌区。 */
  brand?: StripBrand;
  /** 分类计数覆盖:本机插排数「已装本地插件」,不数插排上的管理器插头自身。 */
  count?: number;
}) {
  const b = brand ?? { name: "tmd-cli", role: t("客户端 · 插排本体"), master: t("总电源常开") };
  return (
    <div className="pm-strip-scene">
      <div className="pm-strip">
        <div className="pm-strip-brand">
          <div className="pm-brand-name">{b.name}</div>
          <div className="pm-brand-role">{b.role}</div>
          <div className="pm-master-row">
            <span className="pm-master-led" aria-hidden />
            <span className="pm-master-label">{b.master}</span>
          </div>
        </div>
        {groups.map((g) => (
          <div className="pm-cat-group" key={g.category}>
            <div className="pm-cat-label">
              {t("{label} · {n} 位", { label: t(CATEGORY_LABEL[g.category]), n: count ?? g.rows.length })}
            </div>
            <div className="pm-cat-outlets">
              {g.rows.map(({ plugin, on, dirty }) => (
                <Outlet
                  key={plugin.id}
                  id={plugin.id}
                  name={plugin.meta.name}
                  abbr={plugin.meta.abbr}
                  icon={plugin.meta.icon}
                  iconColor={plugin.meta.iconColor}
                  core={plugin.meta.category === "core"}
                  on={on}
                  dirty={dirty}
                  onToggle={onToggle}
                  onOpenMarket={onOpenMarket}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface Row {
  plugin: Plugin;
  /** 期望态(disabledPlugins 反相)。 */
  on: boolean;
  dirty: boolean;
}

/** 单个插座单元:插头(可点) + 孔位 + 标签。 */
function Outlet({
  id,
  name,
  abbr,
  icon: Icon,
  iconColor,
  core,
  on,
  dirty,
  onToggle,
  onOpenMarket,
}: {
  id: string;
  name: string;
  /** icon 缺省时的 monogram 兜底。 */
  abbr: string;
  /** 品牌字形/语义图标;缺省回退 abbr。 */
  icon?: ComponentType<{ size: number | string }>;
  /** 图标颜色(CSS color);缺省跟随主题 accent。 */
  iconColor?: string;
  core: boolean;
  /** 期望态:true = 插入。 */
  on: boolean;
  /** 期望态 ≠ 启动态 → 重启后生效。 */
  dirty: boolean;
  onToggle: (id: string) => void;
  /** 二级市场开合(有注册面板的插头才传)。 */
  onOpenMarket?: (id: string) => void;
}) {
  const cls = `pm-outlet${on ? "" : " is-out"}${core ? " is-core" : ""}${dirty ? " is-dirty" : ""}`;
  const tip = core
    ? t("核心插件 · 已焊死,不可拔出")
    : on
      ? t("点击拔出 {id}", { id })
      : t("点击插入 {id}", { id });
  return (
    <div className={cls}>
      {/* 插头本体 = 纯定位容器(原 button 的全部样式都在 .pm-plug 类上,div 外观一致);
          交互由本体内部整面透明热区按钮承担,市场角标(可聚焦控件)与热区并列,
          不嵌套在交互元素内(嵌套会让后代丢失自身语义与焦点行为)。 */}
      <div className="pm-plug">
        <svg className="pm-cord" viewBox="0 0 60 46" aria-hidden>
          <path d={`M30 46 C 30 20, ${on ? 18 : 44} 26, 30 -6`} />
        </svg>
        <div className="pm-plug-body">
          <button
            type="button"
            title={tip}
            aria-pressed={on && !core}
            onClick={() => onToggle(id)}
            style={{
              position: "absolute",
              inset: 0,
              padding: 0,
              border: "none",
              background: "none",
              borderRadius: "inherit",
              cursor: "inherit",
            }}
          >
            {core ? (
              <span className="pm-plug-weld" title={t("核心插件")}>
                <Lock size="0.625rem" aria-hidden />
              </span>
            ) : null}
          </button>
          {(() => {
            const market = onOpenMarket ? getMarketPanel(id) : undefined;
            if (!market) return null;
            const open = () => onOpenMarket?.(id);
            return (
              <button
                type="button"
                className="pm-plug-market"
                title={t(market.title)}
                aria-label={t(market.title)}
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
              >
                <market.icon size="0.5625rem" />
              </button>
            );
          })()}
          {/* 纯装饰灯:放行点击穿透到热区(与嵌在 button 内的原行为一致)。 */}
          <span className="pm-plug-led" style={{ pointerEvents: "none" }} aria-hidden />
          <span className="pm-plug-icon" style={iconColor ? { color: iconColor } : undefined}>
            {Icon ? <Icon size="0.875rem" /> : abbr}
          </span>
          <span className="pm-plug-name">{name}</span>
        </div>
        <div className="pm-prongs" aria-hidden>
          <span className="pm-prong" />
          <span className="pm-prong" />
        </div>
      </div>
      <div className="pm-socket" aria-hidden>
        <span className="pm-socket-hole" />
        <span className="pm-socket-hole" />
      </div>
      <div className="pm-outlet-label">
        {id}
        {dirty ? t(" · 待重启") : ""}
      </div>
    </div>
  );
}

