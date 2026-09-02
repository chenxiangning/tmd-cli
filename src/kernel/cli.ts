/**
 * CLI profile —— 每个 cli-* 插件的声明载体（第六轮决策落地）。
 *
 * 触发符纯透传原则：composer 不做语义，只做补全 UI + 原文注入。
 * `translate` 是唯一的例外钩子（如 omp 的 $skill → /skill:skill）。
 */

import type { ReactNode } from "react";

export type TriggerKind = "skill" | "command" | "file";

/**
 * CLI 磁盘会话 —— 从该 CLI 自己的会话存储扫描出的历史会话。
 * tmd-cli 不做会话映射:列表数据源的真相在各 CLI 的磁盘目录。
 */
export interface CliDiskSession {
  /** CLI 自身的会话 id(omp/pi 的 jsonl uuid、codex 的 rollout id),直接喂 resumeArgs。 */
  id: string;
  /** 展示标题;缺省由 UI 回退到短 id。 */
  title?: string;
  /** 最近修改时间 ms epoch,排序/相对时间展示用。 */
  modifiedAt: number;
  /** 磁盘文件路径(调试用)。 */
  path: string;
}

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
 * CLI 会话当前的只读运行状态。
 * 字段缺失表示对应 CLI 尚未刷盘或格式暂未识别。
 */
export interface CliSessionStatus {
  model?: string;
  thinkingLevel?: string;
}
/** 会话文件中的一条真实用户输入 —— 对话锚点栏的数据单元。 */
export interface CliUserMessage {
  /** CLI 消息 id(omp/pi 的 message id、claude 的 uuid、codex 的 payload id),跨增量窗口去重用。 */
  id: string;
  /** 完整文本:预览卡内容与幕布定位 needle 的共同来源。 */
  text: string;
}

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

export interface CliProfile {
  /** 唯一 id：`omp` / `pi` / `codex`。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** CLI 品牌图标(侧栏会话行/新建会话菜单用),尺寸由调用方给。缺省 = 无图标。 */
  renderIcon?: (size: number) => ReactNode;
  /** 可执行命令（PATH 解析）。 */
  command: string;
  /** 固定参数。 */
  args: string[];
  /** 附加环境变量。 */
  env?: Record<string, string>;
  /** 该 CLI 支持的触发符；未声明 = composer 不反应。 */
  triggers: CliTriggerSpec[];
  /**
   * 触发器补全候选(kind → list)。command/skill 触发符的列表在这里。
   * file 触发符的候选来自 fsListDir,忽略此处。
   */
  suggestions?: Partial<Record<TriggerKind, CliSuggestion[]>>;
  /**
   * 运行时命令/技能发现(磁盘扫描 / CLI 查询),声明后覆盖静态 suggestions;
   * 返回 null 或失败 = 回退静态表。对齐 listSessions 惯例:插件自扫自家存储,
   * kernel 只提供 fs 原语,不理解任何 CLI 的格式。
   */
  listSuggestions?: (
    kind: "command" | "skill",
    cwd: string,
  ) => Promise<CliSuggestion[] | null>;
  /**
   * MCP 服务器发现(读自家 CLI 的配置文件),声明后抽屉出现 MCP 分区;
   * 不声明 = 该 CLI 无此区。返回 null 或失败 = MCP 分区为空。
   * 点击语义由每项的 action/token 声明(codex "$name" insert / claude "/mcp" send)。
   */
  listMcpServers?: (cwd: string) => Promise<CliSuggestion[] | null>;
  /** 恢复 CLI 自身会话的参数模板；缺省 = 不支持恢复。 */
  resumeArgs?: (cliSessionId: string) => string[];
  /**
   * 扫描该 CLI 在 cwd 下的磁盘历史会话。
   * 每个 cli-* 插件声明自己的存储约定(目录布局/slug 规则/文件格式),
   * 内核只提供 fsCollectFiles/fsReadHead/fsReadTail 通用原语,不理解任何 CLI 的格式。
   * 缺省 = 该 CLI 不提供历史列表。
   */
  listSessions?: (cwd: string) => Promise<CliDiskSession[]>;
  /** 读取当前 CLI session 的模型与思考强度,只读且可缺省。 */
  readSessionStatus?: (
    cwd: string,
    cliSessionId: string,
  ) => Promise<CliSessionStatus | null>;
  /**
   * 读取会话文件中的用户消息列表(对话锚点栏数据源),只读且可缺省。
   * full = true 要求全量扫描(会话激活首轮);false 允许尾部窗口增量读。
   * 返回窗口内全部用户消息(按文件顺序);跨窗口去重由内核按 id 完成。
   * 缺省 = 该 CLI 不支持锚点栏。
   */
  readSessionUserMessages?: (
    cwd: string,
    cliSessionId: string,
    full: boolean,
  ) => Promise<CliUserMessage[] | null>;
  /**
   * 读取该 CLI 的默认模型与思考强度(配置层,非会话层)。
   * 用途:全新会话创建即赋值 —— 磁盘会话文件要等首条消息才落盘(实证 omp),
   * 在此之前工具栏只能取自 CLI 的默认配置。磁盘真相落地后由字段级合并自然覆盖。
   */
  readDefaultStatus?: (cwd: string) => Promise<CliSessionStatus | null>;
  /**
   * 发送时用 bracketed paste 协议注入(ESC[200~ 正文 ESC[201~ + CR)。
   *
   * 背景:pi-tui 系(kimi/pi)输入编辑器带"粘贴爆发"启发式 —— 短窗口内连续到达的
   * ≥8 个普通字符视为粘贴,其后紧跟的 CR 会被改写成换行而不提交(防终端里
   * 多行粘贴逐行提交)。composer 是整串一次性写入 PTY,正文 + \r 同帧到达,
   * 在 kimi 0.40 实测必中:文本进了输入框但回车被吞,须再到幕布手按回车。
   * 包上标记后 CLI 走 handlePaste 通路并复位启发式,随后的 CR 正常提交 ——
   * 与真实终端粘贴行为一致。未声明 = 维持裸文本 + CR(claude/codex/omp 等
   * 实测正常,勿盲改;它们的 TUI 无此启发式,注入未知转义反而有风险)。
   */
  bracketedPaste?: boolean;
}
