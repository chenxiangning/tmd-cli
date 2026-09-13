/**
 * CLI profile —— 每个 cli-* 插件的声明载体（第六轮决策落地）。
 *
 * 触发符纯透传原则：composer 不做语义，只做补全 UI + 原文注入。
 * `translate` 是唯一的例外钩子（如 omp 的 $skill → /skill:skill）。
 */

/* 会话内省数据单元自本文件迁出(文件规模铁则);re-export 保持 import 契约。 */
export type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  RemoteExec,
  SessionFileIdentity,
} from "./cliSessionTypes";

/* CliProfile 声明自本件迁出(文件规模铁则);re-export 保持 import 契约。 */
export type { CliProfile } from "./cliProfile";

export type TriggerKind = "skill" | "command" | "file";

export interface CliTriggerSpec {
  /** 触发字符，如 `$` `/` `@`。 */
  char: string;
  kind: TriggerKind;
  /**
   * 发送前的文本翻译。缺省 = 原样透传。
   * 例：omp 插件声明 `(token) => "/skill:" + token.slice(1)`。
   */
  translate?: (token: string) => string;
}

/**
 * CLI 会话当前的只读运行状态 / 用户消息 / 写入事件类型见 ./cliSessionTypes.ts。
 */

/**
 * 触发器补全 UI 候选项 —— composer 下拉与命令抽屉的共同数据单元。
 * file 触发符靠 fsListDir 实时拿,不从此声明。
 */
export type SuggestionAction = "send" | "insert";

export interface CliSuggestion {
  /** 触发符后的部分(不含 char)。例 "$"触发时:"think";"/"触发时:"help"。 */
  value: string;
  /** 给用户看的描述(可选)。 */
  description?: string;
  /**
   * 抽屉点击行为。缺省 "insert"(安全兜底:send 会立即写入 PTY)。
   * 判定规则:bare 合法(无必需参数 / 参数可选 / bare 打开的交互 picker 由幕布内
   * TUI 接管,如 /model)→ "send";有必需参数或需要任务上下文 → "insert"。
   * 初判清单与校准记录:openspec/changes/composer-command-drawer/proposal.md
   */
  action?: SuggestionAction;
  /** 语义图标名(composer drawerIcons 内置集);缺省按 kind 回退通用 glyph(/ $)。 */
  icon?: string;
  /**
   * 完整 wire/插入文本,覆盖按 kind 合成的默认值("/name"、"$name")。
   * 用途:MCP 引用等非标准语法(codex "$<name>" mention、claude "/mcp" 管理入口)。
   * send 时作为 prepareSendPayload 输入(translate 仍生效);insert 时原样插入。
   */
  token?: string;
  /** 覆盖默认分区标题;缺省按 kind(命令 / 技能)。 */
  group?: string;
  /** 同分区内排序权重,小的在前;缺省保持声明顺序。 */
  order?: number;
}

