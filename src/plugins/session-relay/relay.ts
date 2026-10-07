/**
 * 跨引擎接力纯逻辑 ── 摘要组装与目标引擎枚举(单测覆盖)。
 * 摘要 = 确定性组装:经 readSessionTranscript 适配器读角色化块(9 家族全声明,
 * 2026-10-06 起 dsh 源不再落「未提取到历史输入」占位),kernel/transcriptDigest
 * 压缩(用户/助手/工具三角色,截断保末条助手结论),零 AI 调用、可预览可编辑后发送。
 */

import type { CliProfile } from "@kernel/cliProfile";
import type { CliTranscriptBlock } from "@kernel/cli";
import { t } from "@kernel/i18n";
import { renderTranscriptDigest, type DigestCaps } from "@kernel/transcriptDigest";
/* 跨插件消费 marks 声明的纯函数模块(mobile 树 import cli-* 适配器同款先例);
 * 序列化模板与回链正则成对同步,不得在 relay 侧另造格式。 */
import { serializeMark } from "../marks/sendTransform";

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

/** 携带标注的最小形状(marks Mark 的结构子集)。 */
export interface CarryMark {
  path: string;
  startLine: number;
  endLine: number;
  note: string;
  excerpt: string;
}

/** 摘要 + 携带标注引用块 → 首发 prompt 全文(与 composer 变换同模板;
 *  无携带原样返回)。翻转 sent 由调用方在写入成功后执行(失败不翻)。 */
export function appendCarriedMarks(summary: string, marks: readonly CarryMark[]): string {
  if (marks.length === 0) return summary;
  const block = marks.map((m) => serializeMark(m)).join("\n\n");
  return `${summary}\n\n${t("请看我在文件里标记的 {n} 处:", { n: marks.length })}\n${block}`;
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
