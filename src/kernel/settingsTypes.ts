/**
 * 设置领域类型与默认值 —— 自 settings.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:AppSettings 及关联类型、枚举白名单、默认值表、会话列表配额解析。
 * store/持久化/面板态留在 settings.ts;字段清洗在 settingsSanitize.ts。
 */

import type { SshHostConfig } from "./sshTypes";
import {
  SESSION_TABS_LIMIT_DEFAULT,
  TERMINAL_FONT_SIZE_DEFAULT,
  UI_FONT_SIZE_DEFAULT,
  UI_ZOOM_DEFAULT,
  DEFAULT_ICON_DECOR,
  type IconDecorId,
  type IconDecorItem,
  type UiLanguage,
} from "./settingsAppearance";
import {
  DEFAULT_DARK_THEME_PRESET_ID,
  DEFAULT_LIGHT_THEME_PRESET_ID,
  type ThemePresetId,
} from "./themePresets";

export type ThemePreference = "system" | "light" | "dark" | "custom";
/** 发送快捷键:"enter" = Enter 发送 / Shift+Enter 换行;"cmdOrCtrlEnter" = ⌘/Ctrl+Enter 发送 / Enter 换行。 */
export type SendShortcut = "enter" | "cmdOrCtrlEnter";
/** Ask 提示音效 id(内置 wav 资产,见 kernel/askSound.ts 加载器)。 */
export type AskSoundId = "default" | "chime" | "bell" | "ding";
/** Ask 提示音效白名单(清洗与播放共用)。 */
export const ASK_SOUND_IDS: readonly AskSoundId[] = ["default", "chime", "bell", "ding"];

/**
 * 工作区会话列表显示预算(参考 codemoss 工作区设置,改为预算分配语义):
 * 总数 total 是一个工作区内所有 CLI 分组共享的初始露出条数;
 * perCli 按 CLI 预留配额,不变式 sum(perCli) ≤ total;
 * 未配置的 CLI 均分剩余(见 resolveCliSessionQuota)。
 */
export interface SessionListBudget {
  /** 初始露出的磁盘历史总条数(所有 CLI 分组共享)。 */
  total: number;
  /** 按 CLI 预留的条数;缺省的 CLI 均分剩余。 */
  perCli: Record<string, number>;
}

/** 显示总数合法域:1–100,默认 20(4 个 CLI 均分 ≈ 每组 5 条)。 */
export const SESSION_LIST_TOTAL_DEFAULT = 20;
export const SESSION_LIST_TOTAL_MIN = 1;
export const SESSION_LIST_TOTAL_MAX = 100;

/**
 * 解析某 CLI 分组的初始露出条数。
 * 已配置 = 配额原值(可为 0:该组初始不露出历史,仅活会话 + 「更多...」);
 * 未配置 = floor(剩余预算 / 未配置 CLI 数),可整除尽,剩余尾数不补。
 * registeredCliIds 由调用方给(内核不认识 CLI 注册表)。
 * 已分配只计注册集内 key:已卸载 CLI 的残留 perCli 不抬高占用
 * (与 session-budget 的 prunePerCli 同不变式)。
 */
export function resolveCliSessionQuota(
  budget: SessionListBudget,
  cliId: string,
  registeredCliIds: readonly string[],
): number {
  const explicit = budget.perCli[cliId];
  if (explicit !== undefined) return explicit;
  const allocated = registeredCliIds.reduce(
    (sum, id) => sum + (budget.perCli[id] ?? 0),
    0,
  );
  const unallocatedCount = registeredCliIds.filter(
    (id) => budget.perCli[id] === undefined,
  ).length;
  if (unallocatedCount === 0) return 0;
  return Math.max(0, Math.floor((budget.total - allocated) / unallocatedCount));
}

/** 置顶作用域:"global" = 左侧栏全局置顶区;"workspace" = 工作区 CLI 分组内顶部。 */
export type SessionPinScope = "global" | "workspace";

/** 单条置顶记录:作用域 + 置顶时间戳(ms) + 标题快照。 */
export interface SessionPinEntry {
  scope: SessionPinScope;
  pinnedAt: number;
  title: string;
}

/** 单条归档记录:仅归档时间戳(ms);归档语义见 kernel/sessionArchive.ts。 */
export interface SessionArchiveEntry {
  archivedAt: number;
}

/** 单条删除意图(tombstone)记录:仅删除时间戳(ms);语义见 kernel/sessionDeleted.ts。
 *  后台删盘失败时管理态仍删除并隐藏,磁盘数据保留(用户意图归 tmd-cli 所有)。 */
export interface SessionDeletedEntry {
  deletedAt: number;
}

/** Git 面板视图段(git 插件编辑域):差异 / 分支 / 历史。 */
export type GitPanelView = "diff" | "branch" | "history";
/** Git 差异文件列表布局:flat 平铺(status 原文三段分区)/ tree 目录树。 */
export type GitFileListLayout = "flat" | "tree";

export interface AppSettings {
  theme: ThemePreference;
  /** 浅色外观使用的 preset(system/light 模式生效)。 */
  lightThemePresetId: ThemePresetId;
  /** 深色外观使用的 preset(system/dark 模式生效)。 */
  darkThemePresetId: ThemePresetId;
  /** 自定义模式当前 preset。 */
  customThemePresetId: ThemePresetId;
  /** 界面语言:zh 源中文恒等;en/ja 查 kernel/i18n 词典,缺失回落源串。切换 = 根组件重挂载。 */
  language: UiLanguage;
  /** 终端字号(px,10-20,默认 13);TerminalView 订阅即时生效。 */
  terminalFontSize: number;
  /** 终端字体 CSS family 串;空 = 平台默认等宽栈(kernel/TerminalView 内表)。 */
  terminalFontFamily: string;
  /** 界面字号(px,12-20,默认 16)= html 根字号;rem 文字/图标随缩放,见 kernel/uiFontSize.ts。 */
  uiFontSize: number;
  /** 界面缩放(0.8-1.5 步进 0.05);Tauri webview setZoom,浏览器 dev 兜底 CSS zoom。 */
  uiZoom: number;
  /** 图标装饰:8 个界面图标的独立颜色/呼吸闪烁(外观页可调;应用层 kernel/iconDecor.ts)。 */
  iconDecor: Record<IconDecorId, IconDecorItem>;
  /** 顶栏中央会话标题 tab 条开关(外观页可调,默认开启;见 kernel/sessionTabs.ts)。 */
  sessionTabsEnabled: boolean;
  /** 会话标题 tab 条容量(1-10,默认 4;外观页可调,缩容即时修剪)。 */
  sessionTabsMax: number;
  /** Composer 发送快捷键行为。 */
  sendShortcut: SendShortcut;
  /** Ask/确认面板提示音开关(行为页可调,默认开启)。 */
  askSoundEnabled: boolean;
  /** Ask 提示音效 id。 */
  askSoundId: AskSoundId;
  /** 对话轮次结束(未被查看)提示音开关,默认开启。 */
  turnEndSoundEnabled: boolean;
  /** 轮次结束提示音效 id(与 Ask 音共用内置 wav 白名单)。 */
  turnEndSoundId: AskSoundId;
  /** 后台提醒:窗口失焦时激活会话完成一轮也视为未查看(标蓝 + 结束音)。 */
  backgroundNotify: boolean;
    /** 单会话输出环形缓冲上限(字符);切回会话的回放深度由它决定,更早历史走幕布翻页。 */
  sessionOutputBufferLimit: number;
  /** 工作区会话列表显示预算(总数 + 按 CLI 配额)。 */
  sessionListBudget: SessionListBudget;
  /** 插件市场"拔出"的插件 id 列表;重启后 activateAll 跳过(插拔语义 = 重启生效)。 */
  disabledPlugins: string[];
  /**
   * 会话手动命名覆盖层:key = `${profileId}:${cliSessionId}`,value = 用户起的标题。
   * 显示优先级:此覆盖 > CLI 磁盘原生标题 > 首条用户消息 > 短 id。
   * 统一走应用侧而非写回 CLI 磁盘文件:omp/pi 的 title 记录是定长 pad 覆写格式,
   * claude/codex 无原生 rename 概念,改写他人私有格式有解析破坏风险(架构决策见 docs/architecture)。
   */
  sessionTitles: Record<string, string>;
  /**
   * 会话置顶层(codemoss 双作用域置顶复刻):key = `${workspaceId}:${profileId}:${cliSessionId}`。
   * - scope "global":会话离开工作区分组,汇入左侧栏顶部「已置顶」全局区;
   * - scope "workspace":会话固定在其 CLI 分组顶部,不参与磁盘历史分页。
   * 两作用域互斥由单 map 结构保证(一个 key 同时只属于一个 scope);
   * title 为置顶时刻的标题快照,供全局区免磁盘扫描直接显示(手动命名覆盖层优先于快照)。
   */
  sessionPins: Record<string, SessionPinEntry>;
  /**
   * 会话归档层:key = `${workspaceId}:${profileId}:${cliSessionId}`,value = 归档时间戳。
   * 默认视图隐藏归档会话;「归档」视图反向只看归档项。应用侧覆盖层,不写回 CLI 磁盘
   * (领域 API 见 kernel/sessionArchive.ts)。
   */
  sessionArchive: Record<string, SessionArchiveEntry>;
  /**
   * 会话删除意图层(tombstone):key = `${workspaceId}:${profileId}:${cliSessionId}`,
   * value = 删除时间戳。删除被调用即记录 —— 后台删盘失败报错时,会话仍从 tmd-cli
   * 管理态移除并在列表隐藏,磁盘数据保留(领域 API 见 kernel/sessionDeleted.ts)。
   */
  sessionDeleted: Record<string, SessionDeletedEntry>;
  /**
   * 左侧栏各工作区会话列表折叠态:key = workspaceId,value = 是否折叠。
   * 缺失的工作区(首次出现)默认折叠;切换折叠/展开与「折叠全部」均写这里,
   * 重启后恢复上次状态。
   */
  workspaceCollapsedMap: Record<string, boolean>;
  /**
   * 左侧栏工作区内各会话分类(CLI 分组 / 终端 / SSH)折叠态:
   * key = `${workspaceId}:${groupId}`(groupId = CLI profileId 或 "shell"/"ssh"),
   * value = 是否折叠。缺失的分类(首次出现)默认折叠;切换写这里,重启后恢复。
   */
  workspaceGroupCollapsedMap: Record<string, boolean>;
  /** 左侧栏会话视图:false = 默认(隐藏归档),true = 归档(只看归档)。 */
  workspaceArchiveView: boolean;
  /**
   * 网络代理(network-proxy 插件的编辑域):客户端自身联网(quota_fetch 等
   * Rust reqwest 请求、installer 的 curl/npm 子进程)与之后 spawn 的 PTY CLI
   * 子进程统一走该代理。生效在 Rust 侧 proxy.rs(进程 env 注入,启动 + 写盘
   * 两个时机),前端只持数值。已在跑的旧会话不受影响,需手动重启。
   */
  networkProxyEnabled: boolean;
  /** 代理地址,http(s)://host:port 或 socks5://host:port;关闭时保留以便重开。 */
  networkProxyUrl: string;
  /**
   * Magic Context 共享记忆库路径(memory-coordinator 安装编排 bootstrap 回存;
   * 空 = 未安装,读侧走上游默认解析)。
   */
  memoryDbPath: string;
  /** Memory 插件启用开关(关闭 = 胶囊与右栏面板全部隐藏)。 */
  memoryEnabled: boolean;
  /** 记忆胶囊注入策略(仅非原生注入引擎生效):manual 手动 / auto 自动展开 / off 关闭。 */
  memoryCapsuleMode: MemoryCapsuleMode;
  /** omp 会话退出后自动沉淀其用户消息(经 omp 官方管线;默认关,显式 opt-in)。 */
  memoryAutoDistill: boolean;
  /** 沉淀提炼模型(空 = 跟随引擎默认)。 */
  memoryDistillModel: string;
  /** 沉淀代写引擎(omp/pi/opencode:谁的会话代执行 ctx_memory 写入)。 */
  memoryDistillEngine: MemoryDistillEngine;
  /** 沉淀补充规则(自由文本,追加到提炼指令;如「特别记住数据库决定;忽略测试细节」)。 */
  memoryDistillRules: string;
  /**
   * Git 面板记忆态(git 插件的编辑域):视图段 + 差异文件列表布局。
   * 顶栏切换即写,重启恢复上次选择;布局默认平铺。
   */
  git: { view: GitPanelView; layout: GitFileListLayout };
  /**
   * SSH 主机簿(ssh 插件的编辑域):终端/SFTP/端口转发共用的主机清单。
   * 凭据明文随 settings.json 落盘(用户裁决,与竞品同级;spec 已记录风险),
   * Web/远端场景不存在 —— 单机应用,不经任何同步通道外发。
   */
  ssh: { hosts: SshHostConfig[] };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  lightThemePresetId: DEFAULT_LIGHT_THEME_PRESET_ID,
  darkThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  customThemePresetId: DEFAULT_DARK_THEME_PRESET_ID,
  language: "zh",
  terminalFontSize: TERMINAL_FONT_SIZE_DEFAULT,
  terminalFontFamily: "",
  uiFontSize: UI_FONT_SIZE_DEFAULT,
  uiZoom: UI_ZOOM_DEFAULT,
  iconDecor: DEFAULT_ICON_DECOR,
  sessionTabsEnabled: true,
  sessionTabsMax: SESSION_TABS_LIMIT_DEFAULT,
  sendShortcut: "enter",
  askSoundEnabled: true,
  askSoundId: "default",
  turnEndSoundEnabled: true,
  turnEndSoundId: "default",
  backgroundNotify: true,
  sessionOutputBufferLimit: 500_000,
  sessionListBudget: { total: SESSION_LIST_TOTAL_DEFAULT, perCli: {} },
  disabledPlugins: [],
  sessionTitles: {},
  sessionPins: {},
  workspaceCollapsedMap: {},
  workspaceGroupCollapsedMap: {},
  sessionArchive: {},
  sessionDeleted: {},
  workspaceArchiveView: false,
  networkProxyEnabled: false,
  networkProxyUrl: "",
  memoryDbPath: "",
  memoryEnabled: true,
  memoryCapsuleMode: "manual",
  memoryAutoDistill: false,
  memoryDistillModel: "",
  memoryDistillEngine: "omp",
  memoryDistillRules: "",
  git: { view: "diff", layout: "flat" },
  ssh: { hosts: [] },
};

/** 记忆胶囊注入策略(manual 手动勾选注入 / auto 新会话自动展开 / off 关闭)。 */
export type MemoryCapsuleMode = "manual" | "auto" | "off";

export type MemoryDistillEngine = "omp" | "pi" | "opencode"; // 三 harness 均注册 ctx_memory
