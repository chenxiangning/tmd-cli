/**
 * 会话预设启动编排(workspace 插件 · 候选4;纯 DI,仿 anim/startSession 两步
 * 管线,node 测试可跑)。spawn 成功后经 kernel pending 队列注入初始提示词,
 * 会话就绪后由 composer 消费 —— pending 只在 spawn 成功路径写,失败零残留。
 * identityTrack 必开(调用方在 deps.spawn 内绑定),否则磁盘身份不绑定,
 * 时间线/审批线全盲(契约见 SessionSpawnService.raw)。
 */

export interface LaunchPresetInput {
  profileId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** 引擎声明的模型旗标;未声明 = 引擎不支持 spawn 期选模,model 忽略(同 createSession 口径)。 */
  modelArg?: string;
  /** 预设模型;非空且引擎声明 modelArg 时追加 `modelArg model` 到进程参数。 */
  model?: string;
  cwd: string;
  title: string;
  /** 已解析的初始提示词(空 = 不注入)。 */
  promptText: string;
  deps: {
    spawn: (spec: {
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      title: string;
    }) => Promise<{ id: string }>;
    setPendingPrompt: (sessionId: string, text: string) => void;
  };
}

export type LaunchPresetResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: "no-engine" | "start-failed" };

export async function launchPresetSession(input: LaunchPresetInput): Promise<LaunchPresetResult> {
  /* 防空 command spawn(WorktreeSessionDialog 候选空禁创建先例);组件侧已禁点,
   * 此处兜底为结构化失败,不静默。 */
  if (!input.command) return { ok: false, reason: "no-engine" };
  const args =
    input.model && input.modelArg ? [...input.args, input.modelArg, input.model] : input.args;
  let sessionId: string;
  try {
    const meta = await input.deps.spawn({
      command: input.command,
      args,
      cwd: input.cwd,
      env: input.env,
      title: input.title,
    });
    sessionId = meta.id;
  } catch {
    /* spawn 被拒的原因已由内核广播 sessionStartFailed(StartFailureToast 呈现)。 */
    return { ok: false, reason: "start-failed" };
  }
  const prompt = input.promptText.trim();
  if (prompt) input.deps.setPendingPrompt(sessionId, prompt);
  return { ok: true, sessionId };
}
