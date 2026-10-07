/**
 * 跨引擎接力纯逻辑 ── 摘要组装与目标引擎枚举(单测覆盖)。
 * 摘要 = 确定性组装:经 readSessionTranscript 适配器读角色化块(9 家族全声明,
 * 2026-10-06 起 dsh 源不再落「未提取到历史输入」占位),kernel/transcriptDigest
 * 压缩(用户/助手/工具三角色,截断保末条助手结论),零 AI 调用、可预览可编辑后发送。
 */

import type { CliProfile } from "@kernel/cliProfile";
import type { CliTranscriptBlock } from "@kernel/cli";
import { renderTranscriptDigest, type DigestCaps } from "@kernel/transcriptDigest";

/** 接力摘要预算(字符):比文章摘录(DIGEST_CAPS 4000)粗 —— 接力要能接着干活,
 *  助手结论与工具产出必须在场;比例沿摘录层(user 最贵,tool 只留指纹)。 */
export const RELAY_DIGEST_CAPS: DigestCaps = { user: 1200, assistant: 1000, tool: 200, session: 6000 };

/** 接力源信息(当前会话侧)。 */
export interface RelaySource {
  profileId: string;
  engineName: string;
  cliSessionId?: string;
  title?: string;
  model?: string | null;
  /** 源会话工作目录(读取器定位磁盘会话用;退出卡来源 = 快照 cwd)。 */
  cwd?: string;
  /** 源会话工作区 id(新会话落位;缺席 = 用当时激活工作区,活会话命令路径同值)。 */
  workspaceId?: string;
  /** 编辑态标记:点击已挂芯片重开弹层时 = 目标会话 id(弹层改「更新/丢弃」,不再建新会话)。 */
  editSessionId?: string;
}

/** 目标引擎候选:除当前外的全部 CLI profile(新会话用它 spawn)。 */
export function relayTargets(profiles: readonly CliProfile[], currentProfileId: string): CliProfile[] {
  return profiles.filter((p) => p.id !== currentProfileId);
}

/** 组装结果:文本 + 截断标记(预览区明示,不让用户误以为全文都在)。 */
export interface RelaySummary {
  text: string;
  /** 摘录层预算截断,或源转录本身超读取预算(32MB)被截。 */
  truncated: boolean;
}


/**
 * 组装接力提示词。blocks 传源会话角色化块(文件顺序;读取失败传 null)。
 * 压缩与截断纪律同 kernel/transcriptDigest:顺序收录超会话预算截断,末条助手
 * 结论保底(换轨至少带上最终结论)。无内容块时给诚实占位(目标引擎自行判断)。
 */
export function buildRelaySummary(
  source: RelaySource,
  blocks: readonly CliTranscriptBlock[] | null,
  sourceTruncated?: boolean,
): RelaySummary {
  const head = source.title
    ? `接力自 ${source.engineName} 会话「${source.title}」`
    : `接力自 ${source.engineName} 会话`;
  const model = source.model ? `(模型 ${source.model})` : "";
  const headLine = `${head}${model}。此前的对话里我提出过:`;
  const tailLine = "请接着以上进度继续工作,不要重复已完成的部分;先简要复述你的理解再动手。";
  const digest = renderTranscriptDigest(blocks ?? [], RELAY_DIGEST_CAPS);
  if (!digest) {
    return { text: [headLine, "(未提取到历史输入,以下为全新开始)", tailLine].join("\n"), truncated: false };
  }
  return {
    text: [headLine, ...digest.lines, tailLine].join("\n"),
    truncated: digest.truncated || !!sourceTruncated,
  };
}
