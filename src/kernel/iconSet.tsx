/**
 * 图标组合(icon set)引擎 —— settings.iconSet → 装饰位字形/线重解析。
 *
 * 组合语义:classic(组合1)= 现状,Fallback 原样渲染、不传 weight(吃全局
 * IconContext bold),仅 newchat 保留现状显式 duotone;solid(组合2)= 同字形
 * weight fill(非 Phosphor 的内联 SVG fallback 不吃线重,原样保持);
 * metaphor(组合3)= 键表换隐喻字形 + bold(候选对照见 docs/design/
 * icon-set-candidates.html)。消费端以 <DecorIcon id Fallback/> 接管,
 * 未接管位自动维持现状。解析表在 iconSetTables.ts(本文件只留组件,
 * react-doctor only-export-components 纪律);kernel 只持跨插件装饰契约
 * (id 白名单先例见 settingsAppearance ICON_DECOR_IDS),不认识消费组件语义。
 */
import type { IconProps } from "@phosphor-icons/react";
import { MorphIcon } from "morphicons/react";
import { useSettingsState } from "./settings";
import type { IconDecorId } from "./settingsAppearance";
import { resolveDecorIcon, type Glyph } from "./iconSetTables";

interface DecorIconProps extends IconProps {
  /** 装饰键(白名单 id);非白名单动态 id 也可传,组合不生效 = 现状。 */
  id: IconDecorId | (string & {});
  /** 组合1 下的现状字形(各消费位当前图标;组合表仅在装饰位覆盖)。 */
  Fallback: Glyph;
}

/** 装饰位图标:按 settings.iconSet 解析。lucide/lucide-alt = MorphIcon 弹簧
 * 变形(4↔5 切换 icon prop 变化自动 morph;Phosphor↔Lucide 跨族切换 = 组件
 * 换型跳变,morphicons 只吃 stroke 图标,Phosphor 是 fill 绘制)。phosphor 分支:
 * 组合未定义 weight 时尊重调用点自传 weight(两态图标 classic 下的
 * active=fill 语义保持)。 */
export function DecorIcon({ id, Fallback, ...rest }: DecorIconProps) {
  const res = resolveDecorIcon(useSettingsState().settings.iconSet, id);
  if (res.kind === "lucide" && res.icon) {
    const { weight: _w, from: _from, to: _to, ref: _ref, ...svgProps } = rest;
    return <MorphIcon icon={res.icon} reducedMotion="user" {...svgProps} />;
  }
  const C = res.glyph ?? Fallback;
  const w = res.weight ?? rest.weight;
  return w === undefined ? <C {...rest} /> : <C {...rest} weight={w} />;
}
