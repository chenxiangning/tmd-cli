/**
 * 图标装饰 · UI 清单(自 IconDecorCard 拆出守 300 行铁则):图标行清单、
 * 界面域分组、图标组合。kernel 只懂键与清洗(settingsAppearance.ts),
 * 这里的 label/icon/group 是纯设置卡展示知识,清单 id 顺序即展示顺序。
 */
import type { ComponentType } from "react";
import {
  ArrowClockwise,
  ArrowsDownUp,
  ArrowUp,
  BellRinging,
  BookmarkSimple,
  Brain,
  BroadcastIcon,
  CalendarDots,
  CaretDown,
  CaretLineLeft,
  CaretLineRight,
  CaretUp,
  Columns,
  Compass,
  Desktop,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderSimplePlus,
  GitBranch,
  GitDiff,
  GitFork,
  HardDrive,
  ListChecks,
  MagicWandIcon,
  MonitorPlay,
  Plug,
  PlugsConnected,
  PuzzlePiece,
  Quotes,
  Robot,
  RocketLaunch,
  Rows,
  SealCheck,
  Sidebar,
  Sparkle,
  TerminalWindow,
  Tray,
  TreeStructure,
} from "@phosphor-icons/react";
import type { IconDecorId, IconSetId } from "@kernel/settings";

/** system-proxy 的梯子图标是 network-proxy 插件内联 SVG,插件间不互 import,此处自绘同形。 */
function LadderIcon({ size = 14 }: { size?: number | string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 4l-3 16" />
      <path d="M18 4l3 16" />
      <path d="M6 9h12" />
      <path d="M6 14h12" />
      <path d="M4.5 19h15" />
    </svg>
  );
}

/** 界面域分组:分组顺序即设置卡展示顺序,label 三语词典键。 */
export const ICON_DECOR_GROUPS = [
  { id: "general", label: "通用与入口" },
  { id: "panels", label: "右栏面板" },
  { id: "sidebar", label: "侧栏与工作区" },
  { id: "composer", label: "输入框" },
  { id: "git", label: "Git" },
  { id: "files", label: "文件树" },
] as const;
export type IconDecorGroup = (typeof ICON_DECOR_GROUPS)[number]["id"];

/** 装饰清单(UI 知识):键覆盖面由文件尾编译期穷尽钉锁定。 */
export const ICON_DECOR_ITEMS: ReadonlyArray<{
  id: IconDecorId;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
  group: IconDecorGroup;
}> = [
  { id: "newchat", label: "新建会话", icon: RocketLaunch, group: "general" },
  { id: "ssh-panel", label: "SSH 入口", icon: HardDrive, group: "general" },
  { id: "system-proxy", label: "网络代理", icon: LadderIcon, group: "general" },
  { id: "wsl-panel", label: "WSL 入口", icon: Desktop, group: "general" },
  { id: "terminal", label: "内置终端", icon: TerminalWindow, group: "general" },
  { id: "intent-canvas", label: "意图画布入口", icon: Compass, group: "general" },
  { id: "session-board", label: "会话看板", icon: CalendarDots, group: "general" },
  { id: "remote-control", label: "远程控制", icon: MonitorPlay, group: "general" },
  { id: "panel-files", label: "文件面板", icon: Folder, group: "panels" },
  { id: "panel-git", label: "Git 面板", icon: GitBranch, group: "panels" },
  { id: "panel-checkpoints", label: "审批线面板", icon: SealCheck, group: "panels" },
  { id: "panel-memory", label: "Memory 面板", icon: Brain, group: "panels" },
  { id: "panel-marks", label: "标记面板", icon: BookmarkSimple, group: "panels" },
  { id: "panel-approval-inbox", label: "审批收件箱面板", icon: BellRinging, group: "panels" },
  { id: "panel-skill-hub", label: "Skills 面板", icon: PuzzlePiece, group: "panels" },
  { id: "panel-mcp-hub", label: "MCP 面板", icon: PlugsConnected, group: "panels" },
  { id: "worktree", label: "Worktree 簇", icon: GitFork, group: "sidebar" },
  { id: "ws-files", label: "查看文件", icon: Rows, group: "sidebar" },
  { id: "ws-manage", label: "会话管理", icon: ListChecks, group: "sidebar" },
  { id: "ws-refresh", label: "刷新会话", icon: ArrowClockwise, group: "sidebar" },
  { id: "market", label: "插件市场", icon: Plug, group: "sidebar" },
  { id: "home", label: "回到首页", icon: Tray, group: "sidebar" },
  { id: "fold-left", label: "折叠左栏", icon: CaretLineLeft, group: "sidebar" },
  { id: "fold-right", label: "折叠右栏", icon: CaretLineRight, group: "sidebar" },
  { id: "stage-expand", label: "展开对话框", icon: CaretUp, group: "composer" },
  { id: "stage-collapse", label: "收起对话框", icon: CaretDown, group: "composer" },
  { id: "composer-drawer", label: "命令与技能", icon: Sidebar, group: "composer" },
  { id: "wake-agent", label: "智能体(##)", icon: Robot, group: "composer" },
  { id: "wake-prompt", label: "提示词(!!)", icon: Quotes, group: "composer" },
  { id: "wake-skill", label: "技能($)", icon: Sparkle, group: "composer" },
  { id: "wake-mcp", label: "MCP 服务器", icon: HardDrive, group: "composer" },
  { id: "ai-draw", label: "AI 作画", icon: Compass, group: "composer" },
  { id: "broadcast", label: "平铺广播", icon: BroadcastIcon, group: "composer" },
  { id: "enhance", label: "增强提示词", icon: MagicWandIcon, group: "composer" },
  { id: "git-open", label: "文件行打开入口", icon: FileText, group: "git" },
  { id: "git-open-location", label: "打开文件位置", icon: FolderOpen, group: "git" },
  { id: "git-row-actions", label: "变更行动作", icon: ListChecks, group: "git" },
  { id: "git-view", label: "Git 视图切换", icon: GitDiff, group: "git" },
  { id: "git-layout", label: "文件列表视图", icon: Rows, group: "git" },
  { id: "git-remote", label: "远端操作", icon: ArrowsDownUp, group: "git" },
  { id: "git-worktree", label: "Worktree 管理", icon: TreeStructure, group: "git" },
  { id: "git-repo-ops", label: "聚合仓行拉取/推送", icon: ArrowUp, group: "git" },
  { id: "git-diff-tools", label: "差异视图工具", icon: Columns, group: "git" },
  { id: "files-new-file", label: "新建文件", icon: FilePlus, group: "files" },
  { id: "files-new-folder", label: "新建文件夹", icon: FolderSimplePlus, group: "files" },
  { id: "files-refresh", label: "刷新文件树", icon: ArrowClockwise, group: "files" },
  { id: "files-git-toggle", label: "按 Git 变更着色文件", icon: GitDiff, group: "files" },
];
type _ItemsCoverAllKeys = Exclude<IconDecorId, (typeof ICON_DECOR_ITEMS)[number]["id"]> extends never
  ? true
  : never;
/** 编译期穷尽钉:kernel 键表加键而本清单漏行时,上行类型塌缩为 never、此处报错(删键方向由 id 类型天然钉住)。 */
export const _itemsCoverAllKeys: _ItemsCoverAllKeys = true;

/** 取色器空值占位(无自定义色时的中性灰)。 */
export const COLOR_PLACEHOLDER = "#808080";

/** 组合清单(UI 知识):id = kernel settings 白名单,label 三语词典键。 */
export const ICON_SETS = [
  { id: "classic", label: "组合1 现状" },
  { id: "solid", label: "组合2 实心" },
  { id: "metaphor", label: "组合3 换隐喻" },
  { id: "lucide", label: "组合4 细线" },
  { id: "lucide-alt", label: "组合5 细线变体" },
] as const satisfies ReadonlyArray<{ id: IconSetId; label: string }>;
