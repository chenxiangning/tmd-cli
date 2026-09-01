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
  /** 恢复 CLI 自身会话的参数模板；缺省 = 不支持恢复。 */
  resumeArgs?: (cliSessionId: string) => string[];
}
