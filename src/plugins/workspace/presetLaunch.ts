/**
 * 会话预设启动编排(workspace 插件 · 候选4;纯 DI,仿 anim/startSession 两步
 * 管线,node 测试可跑)。spawn 成功后经 kernel pending 队列注入初始提示词,
 * 会话就绪后由 composer 消费 —— pending 只在 spawn 成功路径写,失败零残留。
 * identityTrack 必开(调用方在 deps.spawn 内绑定),否则磁盘身份不绑定,
 * 时间线/审批线全盲(契约见 SessionSpawnService.raw)。
 */

import { t } from "@kernel/i18n";
import { dirNameFromBranch, validateDirName, worktreePathFor } from "@plugins/git/worktree/dirName";
import type { WtCreateOutcome } from "./worktreeCreate";
import { wtCreateOutcomeMessage } from "./worktreeCreate";
import { finalBranchName } from "./worktreeSession";

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

/* ── 范围 = 新 worktree 的一键启动(候选4 定稿:无对话框,分支 = 预设名 slug,
 *    finalBranchName 冲突自动递增;建树→spawn→pending 注入复用 runWorktreeCreate
 *    里程碑回滚链;失败经 deps.startFailed 广播 sessionStartFailed 呈现,不静默)。 */

/** git 侧冲突判定集来源:worktree 树占用分支 ∪ 本地分支全集(WtSessionDialog 同源)。 */
export interface WorktreeGitInfo {
  takenBranches: string[];
  localBranches: string[];
}

export interface LaunchPresetWorktreeInput {
  profileId: string;
  /** 预设名:分支基名 slug 源 + 会话标题。 */
  name: string;
  workspaceRoot: string;
  args: string[];
  env: Record<string, string>;
  /** 引擎声明的模型旗标;与 model 同给才追加进程参数(同 launchPresetSession 口径)。 */
  modelArg?: string;
  model?: string;
  /** 已解析的初始提示词(空 = 不注入)。 */
  promptText: string;
  deps: {
    /** null = 非 git 仓(worktreeList 失败,NotGit 前置拦截同款)。 */
    gitInfo: (cwd: string) => Promise<WorktreeGitInfo | null>;
    create: (input: {
      repoCwd: string;
      wtPath: string;
      finalBranch: string;
      newBranch: true;
      engineId: string;
      title: string;
      spawnArgs: string[];
      spawnEnv: Record<string, string>;
      promptText: string;
    }) => Promise<WtCreateOutcome>;
    /** 失败呈现(组件侧广播 sessionStartFailed → StartFailureToast)。 */
    startFailed: (reason: string) => void;
  };
}

export async function launchPresetWorktreeSession(
  input: LaunchPresetWorktreeInput,
): Promise<{ ok: boolean }> {
  const info = await input.deps.gitInfo(input.workspaceRoot);
  if (!info) {
    input.deps.startFailed(t("非 git 仓库,无法创建 worktree"));
    return { ok: false };
  }
  /* 分支 = 预设名 slug 加 wt/ 前缀,树占用 ∪ 本地分支全集中冲突自动 -2/-3。 */
  const conflictSet = new Set([...info.takenBranches, ...info.localBranches]);
  const finalBranch = finalBranchName(dirNameFromBranch(input.name), conflictSet);
  const dirName = dirNameFromBranch(finalBranch);
  const dirErr = validateDirName(dirName);
  const wtPath = dirErr ? null : worktreePathFor(input.workspaceRoot, dirName);
  if (!wtPath) {
    input.deps.startFailed(dirErr ?? t("无法确定 worktree 目录"));
    return { ok: false };
  }
  const spawnArgs =
    input.model && input.modelArg ? [...input.args, input.modelArg, input.model] : input.args;
  const outcome = await input.deps.create({
    repoCwd: input.workspaceRoot,
    wtPath,
    finalBranch,
    newBranch: true,
    engineId: input.profileId,
    title: input.name,
    spawnArgs,
    spawnEnv: input.env,
    promptText: input.promptText.trim(),
  });
  if (!outcome.ok) {
    input.deps.startFailed(wtCreateOutcomeMessage(outcome));
    return { ok: false };
  }
  return { ok: true };
}
