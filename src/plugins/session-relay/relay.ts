/**
 * 跨引擎接力纯逻辑 ── 摘要组装与目标引擎枚举(单测覆盖)。
 * 摘要 = 确定性组装(最近 N 条用户 prompt + 引擎/模型/标题),零 AI 调用、
 * 可预览可编辑后发送;不读助手正文、不解析 CLI 私有格式。
 */

import type { CliProfile } from "@kernel/cliProfile";
import type { CliUserMessage } from "@kernel/cliSessionTypes";

/** 摘要携带的最近 prompt 条数。 */
export const SUMMARY_PROMPT_LIMIT = 10;

/** 接力源信息(当前会话侧)。 */
export interface RelaySource {
  profileId: string;
  engineName: string;
  cliSessionId?: string;
  title?: string;
  model?: string | null;
}

/** 目标引擎候选:除当前外的全部 CLI profile(新会话用它 spawn)。 */
export function relayTargets(profiles: readonly CliProfile[], currentProfileId: string): CliProfile[] {
  return profiles.filter((p) => p.id !== currentProfileId);
}

/**
 * 组装接力提示词。prompts 传全量用户消息(文件顺序),函数取最近
 * SUMMARY_PROMPT_LIMIT 条;无消息时给出诚实占位(目标引擎自行判断)。
 */
export function buildRelaySummary(
  source: RelaySource,
  prompts: readonly CliUserMessage[],
): string {
  const recent = prompts.slice(-SUMMARY_PROMPT_LIMIT).map((m, i) => `${i + 1}. ${m.text}`);
  const head = source.title
    ? `接力自 ${source.engineName} 会话「${source.title}」`
    : `接力自 ${source.engineName} 会话`;
  const model = source.model ? `(模型 ${source.model})` : "";
  const lines = [
    `${head}${model}。此前的对话里我提出过:`,
    ...recent,
    "请接着以上进度继续工作,不要重复已完成的部分;先简要复述你的理解再动手。",
  ];
  if (recent.length === 0) lines.splice(1, 0, "(未提取到历史输入,以下为全新开始)");
  return lines.join("\n");
}
