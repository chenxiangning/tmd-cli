/**
 * CLI profile —— 每个 cli-* 插件的声明载体（第六轮决策落地）。
 *
 * 触发符纯透传原则：composer 不做语义，只做补全 UI + 原文注入。
 * `translate` 是唯一的例外钩子（如 omp 的 $skill → /skill:skill）。
 */

import type { ReactNode } from "react";
import type { QuotaFetchContext, QuotaSnapshot } from "./quota";
import type { SpawnSpec } from "./ipc";
import type { CliPrerequisite } from "./cliPrerequisite";
import type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  RemoteExec,
  SessionFileIdentity,
} from "./cliSessionTypes";

/* 会话内省数据单元自本文件迁出(文件规模铁则);re-export 保持 import 契约。 */
export type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  RemoteExec,
  SessionFileIdentity,
} from "./cliSessionTypes";

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

export interface CliProfile {
  /** 唯一 id：`omp` / `pi` / `codex`。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** CLI 品牌图标(侧栏会话行/新建会话菜单用),尺寸由调用方给。缺省 = 无图标。 */
  renderIcon?: (size: number | string) => ReactNode;
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
  /** 恢复 CLI 自身会话的参数模板;缺省 = 不支持恢复。 */
  resumeArgs?: (cliSessionId: string) => string[];
  /**
   * 单实例语义:同 profile 至多一个活会话,create 命中 = 聚焦既有不重 spawn
   * (dsh「会话即 host」:同 origin 第二个 `dsh web` 必然 EADDRINUSE 秒退)。
   */
  singleInstance?: boolean;
  /**
   * 远程宿主形态(WSL 发行版内)的会话内省。exec 由来源提供传输
   * (workspaceOrigins.remoteExec,如 SSH+b64 通道),路径/slug/解析等引擎
   * 知识留在本 profile —— 与 listSessions 同一 cwd 语义,但 cwd 是远端
   * posix 路径。缺省 = 该引擎不支持远程形态(来源工作区无历史/状态回填)。
   */
  remoteSessions?: {
    list: (exec: RemoteExec, cwd: string) => Promise<CliDiskSession[]>;
    readStatus?: (
      exec: RemoteExec,
      cwd: string,
      cliSessionId: string,
    ) => Promise<CliSessionStatus | null>;
  };
  /**
   * 扫描该 CLI 在 cwd 下的磁盘历史会话。
   * 每个 cli-* 插件声明自己的存储约定(目录布局/slug 规则/文件格式),
   * 内核只提供 fsCollectFiles/fsReadHead/fsReadTail 通用原语,不理解任何 CLI 的格式。
   * 缺省 = 该 CLI 不提供历史列表。
   */
  listSessions?: (cwd: string) => Promise<CliDiskSession[]>;
  /**
   * 删除该 CLI 的一个磁盘会话(「删除会话」入口的 profile 级实现)。
   * 单库多会话 CLI(opencode:多个会话共享一个 sqlite 文件,CliDiskSession.path
   * 是合成路径)无法用 fsRemovePath 删文件,声明此钩子走代写原语;
   * 文件/目录型 CLI(kimi/qoder 等)不声明,workspace 照旧 fsRemovePath。
   * 错误处理归调用方:sessionOps 捕获后按「删除意图」原则记 tombstone 并
   * 清管理态覆盖层,不阻塞用户意图(磁盘数据保留 + console.warn 诊断)。
   */
  deleteSession?: (cliSessionId: string) => Promise<void>;
  /** 读取当前 CLI session 的模型与思考强度,只读且可缺省。 */
  readSessionStatus?: (
    cwd: string,
    cliSessionId: string,
  ) => Promise<CliSessionStatus | null>;
  /**
   * 思考位点击发送的命令(如 dsh "/effort"):声明后工具栏「思考」位可点,
   * 点击 = 写该命令进幕布触发 CLI 的强度选择;缺省 = 只读展示(omp 等在 /model
   * 菜单内选强度的 CLI 不声明)。与模型位 sendModelCommand 同构,内核零 dsh 语义。
   */
  thinkingCommand?: string;
  /**
   * 会话文件身份自证:读 CliDiskSession.path 指向的文件(目录类插件自行拼内部路径),
   * 从文件内容提取 {id, cwd, createdAt}。内容级绑定(identityBinding)的数据源 ——
   * mtime 水位仲裁在懒落盘 CLI(omp 首条消息才 flush)+ 同 cwd 并行 spawn 下会
   * 张冠李戴(实证两会话互换),文件内自证 id/cwd/创建时刻则零猜测。
   * 未声明 = 内核退回 mtime 水位仲裁(旧路径,契约由 host.test.ts 守护)。
   */
  readSessionFileIdentity?: (path: string) => Promise<SessionFileIdentity | null>;
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
   * 「AI 写入文件」输出标记(审批线 events 归因):每条正则对剥 ANSI 后的
   * 单行匹配,捕获组 1 = 文件路径(仓库相对或 cwd 内绝对)。
   * 声明后该 CLI 的会话走 events 归因(审批线跟随 AI 输出落账);
   * 未声明 = 回退 git 窗口推断(旧行为)。
   * 标记选词只认工具行字面量(宁可漏报不可误报 —— 手改文件混入批次
   * 比漏记一个文件更伤审批线可信度)。
   */
  editMarks?: RegExp[];
  /**
   * 「阻塞等待用户确认」的界面标记(Ask/确认问答卡片,审批线外的等待确认标签
   * + 提示音数据源,见 kernel/askWatch.ts):每条正则对剥 ANSI 后的页脚窗口
   * (末 5 行)与幕布屏幕底部行匹配。
   * 纪律与 editMarks 相同:宁可漏报不可误报,只认面板页脚/选项字面量;
   * 未声明 = 只用内核通用标记(y/n、Do you want 句式)。
   * 选词位置原则:标记必须出现在面板「尾部」—— 长选项会把面板头部推出
   * 尾窗,底部字面量才稳定落在页脚窗口。
   */
  askMarks?: RegExp[];
  /**
   * 会话磁盘事件流的 AI 写入读取(审批线 events 归因第二信号源)。
   * 从该 CLI 自己的会话 JSONL 提取 edit/write 工具写入的文件 —— 每会话一个
   * 文件,天然按会话隔离,并行会话不串扰(editMarks 的 PTY 标记做不到:
   * 同一幕布字节流无法区分并行写入者,git 窗口推断更做不到)。
   * 契约:返回 ts > sinceTs 的事件(增量;调用方持水位线),路径为 cwd 相对
   * 或 cwd 内绝对;文件尚未落盘(懒 flush CLI 首条消息才建文件)返回 [],
   * 探测失败返回 null(≠ 零事件,调用方保水位线重试)。
   * 声明后该 CLI 的会话走 events 归因(与 editMarks 等效)。
   */
  readSessionEdits?: (
    cwd: string,
    cliSessionId: string,
    sinceTs: number,
  ) => Promise<CliSessionEdit[] | null>;
  /**
   * 发送时用 bracketed paste 协议注入(ESC[200~ 正文 ESC[201~ + CR)。
   *
   * 背景:pi-tui 系(kimi/pi)输入编辑器带"粘贴爆发"启发式 —— 短窗口内连续到达的
   * ≥8 个普通字符视为粘贴,其后紧跟的 CR 会被改写成换行而不提交(防终端里
   * 多行粘贴逐行提交)。composer 是整串一次性写入 PTY,正文 + \r 同帧到达,
   * 在 kimi 0.40 实测必中:文本进了输入框但回车被吞,须再到幕布手按回车。
   * 包上标记后 CLI 走 handlePaste 通路并复位启发式,随后的 CR 正常提交 ——
   * 与真实终端粘贴行为一致。未声明 = 维持裸文本 + CR。
   * 阵营(2026-09-06 PTY 探针实测):kimi/pi/omp(pi-tui 系)+ codex(crossterm,
   * 启动/恢复窗与斜杠弹层活跃态裸 CR 被吞,BP 后 /model 稳定执行)。grok 实测
   * 反例:BP 块被整体吞掉不提交,必须维持裸文本 —— 新增 CLI 时两态都要探针实测
   * (就绪态 + 启动/恢复窗),不得按家族推测。
   */
  bracketedPaste?: boolean;
  /**
   * spawn 前动态改写 SpawnSpec:插件在运行时注入连接参数/路径等动态值。
   * 例 dsh 适配器需要 DSH host:port(来自 localStorage),无法在 profile 声明期固定。
   * 返回改写后的 spec;缺省 = 不改写(直接用 command/args)。
   */
  spawnTransform?: (spec: SpawnSpec) => SpawnSpec | Promise<SpawnSpec>;

  /**
   * 该 CLI 的额度抓取器(composer 状态条 QuotaChip / welcome 供应商盘点消费)。
   * 声明后内核自动接线进 kernel/quota 注册表(按 profileId 索引);
   * 未声明 = 该 CLI 无额度位。失败时 throw,由消费方渲染错误态。
   */
  fetchQuota?: (ctx: QuotaFetchContext) => Promise<QuotaSnapshot>;

  /* ── 安装/展示元数据(welcome 引擎卡消费;与 renderIcon 同性质的声明字段)── */

  /** 官方文档 URL;缺省 = 引擎卡不显示「官方文档」链接。 */
  docsUrl?: string;
  /** npm 包名(不带 @latest):registry 最新版查询 + npm 通道一键安装共用。 */
  npmPackage?: string;
  /**
   * 官方脚本安装通道(优先于 npm):unix/windows 为完整命令串。
   * 例 claude:unix `curl -fsSL https://claude.ai/install.sh | bash`。
   * 安装命令经通用 IPC 原语执行,Rust 不持有任何 CLI 配方。
   */
  scriptInstall?: { unix: string; windows: string };
  /**
   * 命令通道安装(program + args 原样):介于 script 与 npm 之间的通用通道,
   * 例 omp 经 `bun install -g` 全局安装。安装命令经通用 IPC 原语执行,内核零配方。
   */
  commandInstall?: { program: string; args: string[] };
  /**
   * 前置依赖声明:安装/更新本 CLI 前必须就位的运行时(如 omp 依赖 bun)。
   * welcome 引擎卡先探针依赖;缺失时引导先装依赖,就位前本引擎的
   * 安装/更新按钮不可点。依赖的探针/安装走同一套通用原语(cli_probe / cli_install_run)。
   */
  requires?: CliPrerequisite;
}

