// 插件市场插排视图(分类常量 + 插座单元 + 合并大插排),自 PluginMarketPage.tsx 按「纯结构拆分、行为不变」拆出
import type { ComponentType } from "react";
import { Lock } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { getMarketPanel } from "@kernel/marketPanel";
import type { Plugin, PluginCategory } from "@kernel/plugin";

/** 分类展示顺序与中文名(插排分排 + 清单分节共用)。 */
export const CATEGORY_LABEL: Record<PluginCategory, string> = {
  engine: "CLI 引擎",
  feature: "界面功能",
  core: "核心系统",
  local: "本机插件",
};
export const CATEGORY_ORDER: readonly PluginCategory[] = ["engine", "feature", "core", "local"];
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
}: {
  groups: { category: PluginCategory; rows: Row[] }[];
  onToggle: (id: string) => void;
  /** 二级市场开合(无注册面板的插头不渲染角标)。 */
  onOpenMarket?: (id: string) => void;
  /** 本机插件等次级插排传入独立品牌区。 */
  brand?: StripBrand;
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
              {t("{label} · {n} 位", { label: t(CATEGORY_LABEL[g.category]), n: g.rows.length })}
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
      <button type="button" className="pm-plug" title={tip} aria-pressed={on && !core} onClick={() => onToggle(id)}>
        <svg className="pm-cord" viewBox="0 0 60 46" aria-hidden>
          <path d={`M30 46 C 30 20, ${on ? 18 : 44} 26, 30 -6`} />
        </svg>
        <div className="pm-plug-body">
          {core ? (
            <span className="pm-plug-weld" title={t("核心插件")}>
              <Lock size="0.625rem" aria-hidden />
            </span>
          ) : null}
          {(() => {
            const market = onOpenMarket ? getMarketPanel(id) : undefined;
            if (!market) return null;
            const open = () => onOpenMarket?.(id);
            return (
              <span
                role="button"
                tabIndex={0}
                className="pm-plug-market"
                title={t(market.title)}
                aria-label={t(market.title)}
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.stopPropagation();
                  e.preventDefault();
                  open();
                }}
              >
                <market.icon size="0.5625rem" />
              </span>
            );
          })()}
          <span className="pm-plug-led" aria-hidden />
          <span className="pm-plug-icon" style={iconColor ? { color: iconColor } : undefined}>
            {Icon ? <Icon size="0.875rem" /> : abbr}
          </span>
          <span className="pm-plug-name">{name}</span>
        </div>
        <div className="pm-prongs" aria-hidden>
          <span className="pm-prong" />
          <span className="pm-prong" />
        </div>
      </button>
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

