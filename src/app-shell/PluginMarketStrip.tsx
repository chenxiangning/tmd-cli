// 插件市场插排视图(分类常量 + 插座单元 + 合并大插排),自 PluginMarketPage.tsx 按「纯结构拆分、行为不变」拆出
import type { ComponentType } from "react";
import { Lock } from "lucide-react";
import type { Plugin, PluginCategory } from "@kernel/plugin";

/** 分类展示顺序与中文名(插排分排 + 清单分节共用)。 */
export const CATEGORY_LABEL: Record<PluginCategory, string> = {
  engine: "CLI 引擎",
  feature: "界面功能",
  core: "核心系统",
};
export const CATEGORY_ORDER: readonly PluginCategory[] = ["engine", "feature", "core"];

export interface Row {
  plugin: Plugin;
  /** 启动态(本次激活与否)。 */
  bootOn: boolean;
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
}: {
  id: string;
  name: string;
  /** icon 缺省时的 monogram 兜底。 */
  abbr: string;
  /** 品牌字形/语义图标;缺省回退 abbr。 */
  icon?: ComponentType<{ size: number }>;
  /** 图标颜色(CSS color);缺省跟随主题 accent。 */
  iconColor?: string;
  core: boolean;
  /** 期望态:true = 插入。 */
  on: boolean;
  /** 期望态 ≠ 启动态 → 重启后生效。 */
  dirty: boolean;
  onToggle: (id: string) => void;
}) {
  const cls = `pm-outlet${on ? "" : " is-out"}${core ? " is-core" : ""}${dirty ? " is-dirty" : ""}`;
  const tip = core
    ? "核心插件 · 已焊死,不可拔出"
    : on
      ? `点击拔出 ${id}`
      : `点击插入 ${id}`;
  return (
    <div className={cls}>
      <button type="button" className="pm-plug" title={tip} aria-pressed={on && !core} onClick={() => onToggle(id)}>
        <svg className="pm-cord" viewBox="0 0 60 46" aria-hidden>
          <path d={`M30 46 C 30 20, ${on ? 18 : 44} 26, 30 -6`} />
        </svg>
        <div className="pm-plug-body">
          {core ? (
            <span className="pm-plug-weld" title="核心插件">
              <Lock size={10} aria-hidden />
            </span>
          ) : null}
          <span className="pm-plug-led" aria-hidden />
          <span className="pm-plug-icon" style={iconColor ? { color: iconColor } : undefined}>
            {Icon ? <Icon size={14} /> : abbr}
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
        {dirty ? " · 待重启" : ""}
      </div>
    </div>
  );
}

/** 合并大插排:tmd-cli 品牌区 + 各分类分区(虚线分隔 + 区内小标签)。 */
export function MergedStrip({
  groups,
  onToggle,
}: {
  groups: { category: PluginCategory; rows: Row[] }[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="pm-strip-scene">
      <div className="pm-strip">
        <div className="pm-strip-brand">
          <div className="pm-brand-name">tmd-cli</div>
          <div className="pm-brand-role">客户端 · 插排本体</div>
          <div className="pm-master-row">
            <span className="pm-master-led" aria-hidden />
            <span className="pm-master-label">总电源常开</span>
          </div>
        </div>
        {groups.map((g) => (
          <div className="pm-cat-group" key={g.category}>
            <div className="pm-cat-label">
              {CATEGORY_LABEL[g.category]} · {g.rows.length} 位
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
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
