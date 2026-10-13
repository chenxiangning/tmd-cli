/**
 * 工作台 · 默认会话引擎(kernel settings.workbenchDefaultEngine,概览页选择条
 * 可配)。所有从工作台发起的 spawn(任务开会话 / 在此目录开新会话 / 生成文档 /
 * journal 首跑引擎)优先取它;未设置或指向已失效 profile 时回落既有行为
 * (该目录最近会话的引擎 / omp),不另设猜测。
 */

import { getSettingsState } from "@kernel/settings";
import { host } from "@kernel/host";
import type { CliProfile } from "@kernel/cli";

/** 默认引擎解析结果;model = 该引擎记住的模型(空 = 引擎默认,undefined 不传参)。 */
export interface ResolvedDefaultEngine {
  profileId: string;
  model?: string;
}

/** 选择条候选:有会话扫描能力的引擎档位(dsh 合成目录只读,不作生成/开会话引擎,GenSettings 同款过滤)。 */
export function defaultEngineCandidates(): CliProfile[] {
  return host.getCliProfiles().filter((p) => p.listSessions && p.id !== "dsh");
}

/** 读当前默认引擎;未设置/非法 id/registry 无此 profile 返回 null(调用方走回落路径)。 */
export function resolveDefaultEngine(): ResolvedDefaultEngine | null {
  const id = getSettingsState().settings.workbenchDefaultEngine;
  if (!id) return null;
  if (!host.getCliProfiles().some((p) => p.id === id)) return null;
  const model = getSettingsState().settings.workbenchEngineModels[id] || undefined;
  return { profileId: id, model };
}
