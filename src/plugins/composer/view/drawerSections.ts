/**
 * 命令抽屉分区常量 —— 自 CommandDrawer.tsx 拆出(文件规模铁则)。
 * 分区顺序/中文名/左缘 rail 图标(UI 铬,非 profile 协议语义)/
 * 动作徽标(颜色全部走主题 token,preset 换色自动跟随)/ 条目展示名。
 */

import { LayoutGrid, Puzzle, Server, Sparkles, SquareTerminal } from "lucide-react";
import type { DrawerIconComponent } from "../drawerIcons";
import type { DrawerItem, DrawerSection } from "../drawerItems";

export const SECTION_ORDER: DrawerSection[] = ["command", "skill", "mcp", "plugin"];
export const SECTION_META: Record<DrawerSection, { label: string; glyph: string }> = {
  command: { label: "命令", glyph: "/" },
  skill: { label: "技能", glyph: "$" },
  mcp: { label: "MCP", glyph: "⧉" },
  plugin: { label: "插件", glyph: "▣" },
};

/** 左缘 rail 分区图标(UI 铬,非 profile 协议语义;文案进 title/aria-label)。 */
export const SECTION_TAB_ICONS: Record<"all" | DrawerSection, DrawerIconComponent> = {
  all: LayoutGrid,
  command: SquareTerminal,
  skill: Sparkles,
  mcp: Server,
  plugin: Puzzle,
};

/** 动作徽标:软填充色芯片(不用描边,亮色系主题下描边 pill 过于抢眼);
    颜色全部走主题 token,preset 换色自动跟随。 */
export const MODE_TAG: Record<DrawerItem["action"], { label: string; cls: string; hint: string }> = {
  send: { label: "⚡ 直接发送", cls: "bg-(--tmd-accent-soft) text-(--tmd-accent)", hint: "直接发送到幕布" },
  insert: { label: "↵ 插入", cls: "bg-(--tmd-bg-hover) text-(--tmd-fg-muted)", hint: "插入输入框继续编辑" },
  open: { label: "⇱ 打开", cls: "bg-(--tmd-diff-inserted)/10 text-(--tmd-diff-inserted)", hint: "打开对应面板" },
};

export function displayName(item: DrawerItem): string {
  if (item.section === "command") return `/${item.name}`;
  if (item.section === "skill") return `$${item.name}`;
  return item.name;
}
