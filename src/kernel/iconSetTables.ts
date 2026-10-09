/**
 * 图标组合解析表(自 iconSet.tsx 拆出:组件文件只留组件,react-doctor 纪律)。
 * 组合语义与消费约定见 iconSet.tsx 头注;候选对照 docs/design/icon-set-candidates.html。
 */
import type { ComponentType } from "react";
import {
  ArrowCounterClockwise,
  ArrowFatUp,
  ArrowSquareOut,
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  Broadcast,
  Checks,
  Circuitry,
  ClockCounterClockwise,
  Cloud,
  Code,
  CompassTool,
  Cpu,
  Eye,
  FlagBanner,
  Folders,
  FolderPlus,
  GitFork,
  GitMerge,
  GraduationCap,
  HeadCircuit,
  Highlighter,
  House,
  Lightbulb,
  Lightning,
  LinuxLogo,
  ListBullets,
  ListDashes,
  LockKey,
  Megaphone,
  NotePencil,
  PaintBrushBroad,
  Plugs,
  SidebarSimple,
  Sparkle,
  SquaresFour,
  Stairs,
  Storefront,
  Table,
  TextAa,
  Tray,
  TreeStructure,
} from "@phosphor-icons/react";
import type { IconProps, IconWeight } from "@phosphor-icons/react";
import { LUCIDE_A, LUCIDE_B } from "./iconSetTablesLucide";
import type { IconNode as LucideNode } from "lucide";
import type { IconDecorId, IconSetId } from "./settingsAppearance";

export type Glyph = ComponentType<IconProps>;

/** 组合3(换隐喻)字形表(fold-left/fold-right 除外 —— 双态方向性 affordance,
 * 字形本体指示折叠方向,换字形丢语义,仅颜色/闪烁对它们生效)。 */
const METAPHOR_GLYPHS: Partial<Record<IconDecorId, Glyph>> = {
  newchat: Sparkle,
  "ssh-panel": LockKey,
  "system-proxy": Stairs,
  "panel-files": Folders,
  "panel-git": GitMerge,
  "panel-checkpoints": ClockCounterClockwise,
  "panel-memory": HeadCircuit,
  "panel-marks": FlagBanner,
  "panel-approval-inbox": Tray,
  "panel-skill-hub": GraduationCap,
  "panel-mcp-hub": Plugs,
  "wsl-panel": LinuxLogo,
  terminal: Code,
  "intent-canvas": CompassTool,
  "session-board": SquaresFour,
  "remote-control": Broadcast,
  worktree: TreeStructure,
  "ws-files": Table,
  "ws-manage": ListDashes,
  "ws-refresh": ArrowsClockwise,
  market: Storefront,
  home: House,
  "stage-expand": ArrowsOutSimple,
  "stage-collapse": ArrowsInSimple,
  "composer-drawer": SidebarSimple,
  "wake-agent": Cpu,
  "wake-prompt": TextAa,
  "ai-draw": PaintBrushBroad,
  broadcast: Megaphone,
  enhance: Lightning,
  "wake-skill": Lightbulb,
  "wake-mcp": Circuitry,
  "git-open": ArrowSquareOut,
  "git-row-actions": Checks,
  "git-view": Eye,
  "git-layout": ListBullets,
  "git-remote": Cloud,
  "git-worktree": GitFork,
  "git-repo-ops": ArrowFatUp,
  "files-new-file": NotePencil,
  "files-new-folder": FolderPlus,
  "files-refresh": ArrowCounterClockwise,
  "files-git-toggle": Highlighter,
};

/** 组合1(现状)显式线重表:仅 newchat(接管 WorkspaceCard 原显式 duotone)。 */
const CLASSIC_WEIGHTS: Partial<Record<IconDecorId, IconWeight>> = { newchat: "duotone" };



/** 组合解析结果:phosphor = Phosphor 组件字形/线重;lucide = Lucide IconNode
 * (morphicons 弹簧变形引擎吃的数据形态)。 */
interface DecorResolution {
  kind: "phosphor" | "lucide";
  glyph?: Glyph;
  weight?: IconWeight;
  icon?: LucideNode;
}

/** 组合解析(纯函数,测试面):classic/solid/metaphor 见上;lucide/lucide-alt
 *  走 Lucide 表。id 放宽为 string:动态注册的面板/动作(白名单外)与 fold
 *  双键一律 phosphor(classic 语义原样 Fallback)。 */
export function resolveDecorIcon(set: IconSetId, id: string): DecorResolution {
  if (set === "lucide" || set === "lucide-alt") {
    const table = set === "lucide" ? LUCIDE_A : LUCIDE_B;
    const icon = Object.hasOwn(table, id) ? table[id as IconDecorId] : undefined;
    return icon ? { kind: "lucide", icon } : { kind: "phosphor" };
  }
  if (set === "solid") return { kind: "phosphor", weight: "fill" };
  if (set === "metaphor") {
    return {
      kind: "phosphor",
      glyph: Object.hasOwn(METAPHOR_GLYPHS, id) ? METAPHOR_GLYPHS[id as IconDecorId] : undefined,
      weight: "bold",
    };
  }
  return {
    kind: "phosphor",
    weight: Object.hasOwn(CLASSIC_WEIGHTS, id) ? CLASSIC_WEIGHTS[id as IconDecorId] : undefined,
  };
}
