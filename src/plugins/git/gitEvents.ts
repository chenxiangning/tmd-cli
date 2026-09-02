/**
 * git 插件事件契约 —— 经 host.events(EventBus)流通。
 *
 * 安全不变量(design §6):commit 唯一触发入口是面板「✓ 提交」按钮;
 * composer 只允许预填消息,禁止任何形式的 PTY git 指令反射。
 */

/** composer 输入 `/commit <msg>` 时 emit;git 面板预填提交框并切到差异视图。 */
export const GIT_PREFILL_TOPIC = "git://composer-prefill";

export interface GitPrefillPayload {
  message: string;
}
