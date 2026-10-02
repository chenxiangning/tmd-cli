/**
 * 跨引擎接力纯逻辑 ── 摘要组装与目标引擎枚举(单测覆盖)。
 * 摘要 = 确定性组装(最近 N 条用户 prompt + 引擎/模型/标题),零 AI 调用、
 * 可预览可编辑后发送;不读助手正文、不解析 CLI 私有格式。
 */

import type { CliProfile } from "@kernel/cliProfile";
import type { CliUserMessage } from "@kernel/cliSessionTypes";

/** 摘要携带的最近 prompt 条数。 */
export const SUMMARY_PROMPT_LIMIT = 10;

/** 单条 prompt 截断上限(字符):超长条目(贴日志/贴文件)尾部截断,
 *  防单条即撑爆目标上下文或触发 TUI 粘贴启发式。 */
export const SUMMARY_ITEM_MAX_CHARS = 500;

/** 摘要总长上限(UTF-8 字节,8KB):按字节计 —— 中文一条 500 字已达 ~1.5KB,
 *  10 条满额 ≈ 15KB 仍可撑爆目标上下文,超限从最旧条目起丢弃(保最近进度)。 */
export const SUMMARY_TOTAL_MAX_BYTES = 8 * 1024;

/** UTF-8 字节长度(TextEncoder 惰性单例;测试环境 node 18+ 全局自带)。 */
let encoder: TextEncoder | null = null;
function utf8Bytes(s: string): number {
  encoder ??= new TextEncoder();
  return encoder.encode(s).length;
}

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
  /** 单条或总长截断发生。 */
  truncated: boolean;
}

/** 单条截断(纯函数):超上限尾部加省略号,标记 truncated。 */
function truncateItem(text: string): { text: string; truncated: boolean } {
  if (text.length <= SUMMARY_ITEM_MAX_CHARS) return { text, truncated: false };
  let cut = text.slice(0, SUMMARY_ITEM_MAX_CHARS);
  /* 截点落在代理对中间时回退一位:劈开的半个字符会以孤立代理对进提示词
     (JSON 序列化成坏码点,目标引擎解析端行为不可控)。 */
  const tail = cut.charCodeAt(cut.length - 1);
  const next = text.charCodeAt(cut.length);
  if (tail >= 0xd800 && tail <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    cut = cut.slice(0, -1);
  }
  return { text: `${cut}…`, truncated: true };
}

/**
 * 组装接力提示词。prompts 传全量用户消息(文件顺序),函数取最近
 * SUMMARY_PROMPT_LIMIT 条;再按 单条 500 字 / 总长 8KB 双闸截断(总长超限
 * 从最旧条目起丢弃,至少保最新一条)。无消息时给出诚实占位(目标引擎自行判断)。
 */
export function buildRelaySummary(
  source: RelaySource,
  prompts: readonly CliUserMessage[],
): RelaySummary {
  const recent = prompts.slice(-SUMMARY_PROMPT_LIMIT).map((m) => truncateItem(m.text));
  const head = source.title
    ? `接力自 ${source.engineName} 会话「${source.title}」`
    : `接力自 ${source.engineName} 会话`;
  const model = source.model ? `(模型 ${source.model})` : "";
  const headLine = `${head}${model}。此前的对话里我提出过:`;
  const tailLine = "请接着以上进度继续工作,不要重复已完成的部分;先简要复述你的理解再动手。";
  /* 无消息占位也算「条目」:进同一 items 数组,走同一总长闸。 */
  let items = recent.map((r, i) => `${i + 1}. ${r.text}`);
  if (items.length === 0) items = ["(未提取到历史输入,以下为全新开始)"];
  /* 总长闸(UTF-8 字节,头尾行计入):从最旧条目起丢,最新一条恒保。 */
  const budget = () =>
    utf8Bytes(headLine) + utf8Bytes(tailLine) +
    items.reduce((n, s) => n + utf8Bytes(s) + 1, 0);
  let dropped = false;
  while (items.length > 1 && budget() > SUMMARY_TOTAL_MAX_BYTES) {
    items = items.slice(1);
    dropped = true;
  }
  const truncated = dropped || recent.some((r) => r.truncated);
  return {
    text: [headLine, ...items, tailLine].join("\n"),
    truncated,
  };
}
