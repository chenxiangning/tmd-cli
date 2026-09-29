/**
 * 图标组合解析表(自 iconSet.tsx 拆出:组件文件只留组件,react-doctor 纪律)。
 * 组合语义与消费约定见 iconSet.tsx 头注;候选对照 docs/design/icon-set-candidates.html。
 */
import type { ComponentType } from "react";
import {
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  Broadcast,
  Circuitry,
  ClockCounterClockwise,
  Code,
  CompassTool,
  Cpu,
  FlagBanner,
  Folders,
  GitMerge,
  GraduationCap,
  HeadCircuit,
  House,
  Lightbulb,
  Lightning,
  LinuxLogo,
  ListDashes,
  LockKey,
  Megaphone,
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
import {
  AppWindow,
  ArrowLeft,
  BadgeCheck,
  Bell,
  Blocks,
  Bot,
  Bookmark,
  Brain,
  Brush,
  Cable,
  CalendarDays,
  Cast,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Compass,
  Cpu as LCpu,
  Flag,
  Folder,
  FolderOpen,
  GitBranch,
  GitFork,
  GitMerge as LGitMerge,
  Globe,
  GraduationCap as LGraduationCap,
  History,
  House as LHouse,
  Inbox,
  KeyRound,
  Layers,
  LayoutGrid,
  ListChecks,
  ListTodo,
  Lightbulb as LLightbulb,
  Megaphone as LMegaphone,
  Monitor,
  MonitorPlay,
  Network,
  NotebookPen,
  PanelLeft,
  Palette,
  PenTool,
  Plug,
  Puzzle,
  Radio,
  RefreshCw,
  Rocket,
  RotateCw,
  Rows3,
  Server,
  ShoppingBag,
  Shuffle,
  Sparkles,
  SquareTerminal,
  Star,
  Store,
  Table as LTable,
  Terminal,
  TextQuote,
  UserRound,
  WandSparkles,
  Zap,
} from "lucide";
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
};

/** 组合1(现状)显式线重表:仅 newchat(接管 WorkspaceCard 原显式 duotone)。 */
const CLASSIC_WEIGHTS: Partial<Record<IconDecorId, IconWeight>> = { newchat: "duotone" };


/** 组合4(Lucide 细线)字形表:语义贴近组合1 现状(fold 双键除外,同 metaphor 例外)。 */
const LUCIDE_A: Partial<Record<IconDecorId, LucideNode>> = {
  newchat: Rocket,
  "ssh-panel": Server,
  "system-proxy": Globe,
  "panel-files": Folder,
  "panel-git": GitBranch,
  "panel-checkpoints": History,
  "panel-memory": Brain,
  "panel-marks": Bookmark,
  "panel-approval-inbox": Bell,
  "panel-skill-hub": Puzzle,
  "panel-mcp-hub": Plug,
  "wsl-panel": Monitor,
  terminal: Terminal,
  "intent-canvas": Compass,
  "session-board": CalendarDays,
  "remote-control": MonitorPlay,
  worktree: GitFork,
  "ws-files": Rows3,
  "ws-manage": ListChecks,
  "ws-refresh": RefreshCw,
  market: ShoppingBag,
  home: LHouse,
  "stage-expand": ChevronUp,
  "stage-collapse": ChevronDown,
  "composer-drawer": PanelLeft,
  "wake-agent": Bot,
  "wake-prompt": TextQuote,
  "ai-draw": Palette,
  broadcast: Radio,
  enhance: WandSparkles,
  "wake-skill": LLightbulb,
  "wake-mcp": Blocks,
};

/** 组合5(Lucide 细线变体)字形表:逐键换隐喻,与组合4 逐键不同 → 4↔5 切换全表 morph。 */
const LUCIDE_B: Partial<Record<IconDecorId, LucideNode>> = {
  newchat: Sparkles,
  "ssh-panel": KeyRound,
  "system-proxy": Shuffle,
  "panel-files": FolderOpen,
  "panel-git": LGitMerge,
  "panel-checkpoints": BadgeCheck,
  "panel-memory": LCpu,
  "panel-marks": Flag,
  "panel-approval-inbox": Inbox,
  "panel-skill-hub": LGraduationCap,
  "panel-mcp-hub": Cable,
  "wsl-panel": AppWindow,
  terminal: SquareTerminal,
  "intent-canvas": PenTool,
  "session-board": LayoutGrid,
  "remote-control": Cast,
  worktree: Network,
  "ws-files": LTable,
  "ws-manage": ListTodo,
  "ws-refresh": RotateCw,
  market: Store,
  home: ArrowLeft,
  "stage-expand": ChevronsUp,
  "stage-collapse": ChevronsDown,
  "composer-drawer": Layers,
  "wake-agent": UserRound,
  "wake-prompt": NotebookPen,
  "ai-draw": Brush,
  broadcast: LMegaphone,
  enhance: Zap,
  "wake-skill": Star,
  "wake-mcp": Server,
};

/** 组合解析结果:phosphor = Phosphor 组件字形/线重;lucide = Lucide IconNode
 * (morphicons 弹簧变形引擎吃的数据形态)。 */
export interface DecorResolution {
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
