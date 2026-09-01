/**
 * CLI profile —— 每个 cli-* 插件的声明载体（第六轮决策落地）。
 *
 * 触发符纯透传原则：composer 不做语义，只做补全 UI + 原文注入。
 * `translate` 是唯一的例外钩子（如 omp 的 $skill → /skill:skill）。
 */

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
 * 触发器补全 UI 候选项 —— 给 composer 下拉显示用,不在协议里走。
 * file 触发符靠 fsListDir 实时拿,不从此声明。
 */
export interface CliSuggestion {
  /** 触发符后的部分(不含 char)。例 "$"触发时:"think";"/"触发时:"help"。 */
  value: string;
  /** 给用户看的描述(可选)。 */
  description?: string;
}

export interface CliProfile {
  /** 唯一 id：`omp` / `pi` / `codex`。 */
  id: string;
  /** 显示名。 */
  name: string;
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
  /** 恢复 CLI 自身会话的参数模板；缺省 = 不支持恢复。 */
  resumeArgs?: (cliSessionId: string) => string[];
  /**
   * 探测 CLI 自身 session id。在 spawn 后周期性调用,直到返回非空。
   * 例:omp 的 session 在 ~/.omp/agent/sessions/<cwd-slug>/<ts>_<uuid>.jsonl,
   * 文件创建后从文件名解析 uuid。
   */
  detectCliSessionId?: (cwd: string) => Promise<string | null>;
}
