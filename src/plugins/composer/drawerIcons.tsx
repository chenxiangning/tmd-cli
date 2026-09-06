/**
 * 抽屉语义图标集 —— profile 声明 `icon: "<name>"`,这里解析为 phosphor 组件;
 * 未声明或名称未收录 = 按 section 回退通用 glyph(协议要求:不留空白、不报错)。
 *
 * 新增图标:挑 @phosphor-icons-react 现有导出,在这里登记一行;插件侧永远只写语义名。
 */

import type { ComponentType } from "react";
import { ChartBar, ClipboardText, Cpu, Question, ClockClockwise, StackSimple, Lightbulb, CornersIn, PuzzlePiece, MagnifyingGlass, HardDrive, Sparkle, Trash, type IconProps } from "@phosphor-icons/react";

export type DrawerIconComponent = ComponentType<IconProps>;

/** 语义名 → phosphor 组件。键集合 = cli-profiles 契约单测的白名单。 */
export const DRAWER_ICONS: Record<string, DrawerIconComponent> = {
  help: Question,
  clear: Trash,
  compact: CornersIn,
  usage: ChartBar,
  model: Cpu,
  resume: ClockClockwise,
  skills: Sparkle,
  plugins: StackSimple,
  think: Lightbulb,
  plan: ClipboardText,
  review: MagnifyingGlass,
  server: HardDrive,
};

/** 插件等无语义图标的条目兜底。 */
const DrawerFallbackIcon = PuzzlePiece;

/** 各分区缺省 glyph(无任何图标可解析时)。 */
export const SECTION_GLYPHS: Record<string, string> = {
  command: "/",
  skill: "$",
  mcp: "⧉",
  plugin: "▣",
};

/** 解析一个条目图标:语义名 → 内置集;未收录 → Puzzle;都不合适由调用方再回退 glyph。 */
export function resolveDrawerIcon(
  item: { icon?: string; iconNode?: DrawerIconComponent },
): DrawerIconComponent | null {
  if (item.iconNode) return item.iconNode;
  if (item.icon && DRAWER_ICONS[item.icon]) return DRAWER_ICONS[item.icon];
  if (item.icon) return DrawerFallbackIcon;
  return null;
}
