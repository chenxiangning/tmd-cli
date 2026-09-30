/**
 * 会话内容摘录 —— 每日文章的内容提取层(2026-09-30 重构)。
 *
 * 旧路径只给生成会话一份标题清单,靠 agent 自行只读探测 7 家 CLI 的原始 jsonl 成文,
 * 格式异构导致普遍放弃 → 文章只剩标题复述。现改为:tmd 侧经各 CLI 插件声明的
 * readSessionTranscript 适配器(session-viewer 同款先例)读出角色化块,压缩成当日
 * 摘录文件落盘;生成会话以摘录为事实来源成文。行型知识仍在各家族插件内,本模块
 * 只做块级压缩,不碰任何 CLI 私有格式。
 *
 * 压缩纪律:reasoning/system 丢弃;user/assistant 压单行保头截断;tool 压单行
 * (失败态升格「报错」行,附 detail;适配器词表 error/failed);会话级 + 全日级
 * 双层字符预算,会话截断时保底追加末条助手结论(收尾结论是成文最贵的证据)。
 */
import { host } from "@kernel/host";
import type { CliTranscriptBlock } from "@kernel/cli";
import type { DaySessionRow } from "./daySessions";
import { GEN_TASK_MARK } from "./promptGen";
import { hmOf } from "./timeUtil";

/** 单块与会话级截断预算(字符;user 原话最贵给足,tool 只留指纹)。 */
export interface DigestCaps {
  user: number;
  assistant: number;
  tool: number;
  session: number;
}

export const DIGEST_CAPS: DigestCaps = { user: 800, assistant: 600, tool: 160, session: 4000 };

/** 全日摘录字符预算:超出停止收录(24 会话 × 4KB 也用不满)。 */
export const DAY_CHAR_CAP = 100_000;

/** 任意文本 → 单行安全摘录(空白折叠 + 保头截断);md 结构符随单行化失效。 */
export function capLine(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…(截断)` : one;
}

/** 单块 → 一行摘录;非内容块返回 null。 */
function blockLine(b: CliTranscriptBlock, caps: DigestCaps): string | null {
  const text = b.text.trim();
  if (b.role === "user" && text) return `用户:${capLine(text, caps.user)}`;
  if (b.role === "assistant" && text) return `助手:${capLine(text, caps.assistant)}`;
  if (b.role === "tool") {
    const title = (b.tool?.title || text).trim();
    if (!title) return null;
    /* 失败词表取适配器实产:error(部分家族)/failed(opencode 系透传)。 */
    const failed = b.tool?.status === "error" || b.tool?.status === "failed";
    const head = failed ? "报错" : "动作";
    const detail = failed && b.tool?.detail ? ` — ${capLine(b.tool.detail, caps.tool)}` : "";
    return `${head}:${capLine(title, caps.tool)}${detail}`;
  }
  return null;
}

/** 单会话块列表 → 摘录小节(md;空内容返回 null,调用方按仅标题处理)。 */
export function renderSessionDigest(row: DaySessionRow, blocks: CliTranscriptBlock[], caps: DigestCaps = DIGEST_CAPS): string | null {
  const lines: string[] = [];
  let used = 0;
  let cut = false;
  /* 先全量定位真正末条助手结论:预算截断后循环到不了它,而它恰是收尾最贵证据。 */
  let lastAssistant: string | null = null;
  for (const b of blocks) {
    if (b.role === "assistant" && b.text.trim()) lastAssistant = b.text.trim();
  }
  for (const b of blocks) {
    const line = blockLine(b, caps);
    if (line === null) continue;
    if (used + line.length > caps.session) {
      cut = true;
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return null;
  /* 截断保底:末条助手结论(常含最终结论/复盘)不在预算内时补一行尾摘。 */
  if (cut && lastAssistant) {
    const tail = `助手(结尾):${capLine(lastAssistant, 400)}`;
    if (!lines.includes(`助手:${capLine(lastAssistant, caps.assistant)}`)) lines.push(tail);
  }
  if (cut) lines.push("(摘录超预算,后续内容省略)");
  const head = `### ${hmOf(row.startedAt)} [${row.profileId}] ${row.title}${row.wsName ? `(${row.wsName})` : ""}`;
  return [head, ...lines, ""].join("\n");
}

export interface DayDigest {
  /** 整份摘录 md(无任何会话可摘 = 空串,调用方跳过落盘走无摘录降级)。 */
  md: string;
  /** 实际收录进 md 的会话 id 集(行级 (有摘录) 标注真值)。 */
  coveredIds: string[];
  /** 实际收录小节数 / 进入清单的总会话数。 */
  covered: number;
  total: number;
}

/** 转录读取并发上限:批量全量读+逐行解析全在 webview 主线程,无上限的
 *  Promise.all(实测单日数十会话)会饿死前台幕布渲染(2026-09-30 卡死根因之一)。 */
const DIGEST_READ_CONCURRENCY = 4;

/** 全日摘录装配:逐会话经声明的适配器读转录并压缩;单会话失败跳过不拖垮整日。
 *  分批读取:每批上限 4 会话,批间让出主线程一拍,渲染不至于被转录解析饿死。 */
export async function buildDayDigest(rows: DaySessionRow[]): Promise<DayDigest> {
  const profiles = host.getCliProfiles();
  const parts: Array<{ id: string; part: string | null }> = [];
  for (let i = 0; i < rows.length; i += DIGEST_READ_CONCURRENCY) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const chunk = rows.slice(i, i + DIGEST_READ_CONCURRENCY);
    parts.push(
      ...await Promise.all(
        chunk.map(async (row): Promise<{ id: string; part: string | null }> => {
          const profile = profiles.find((p) => p.id === row.profileId);
          if (!profile?.readSessionTranscript || !row.disk) return { id: row.id ?? "", part: null };
          try {
            const transcript = await profile.readSessionTranscript(row.disk);
            if (!transcript) return { id: row.id ?? "", part: null };
            /* 自指防混入:首条用户消息即生成 prompt 的会话是插件自己 spawn 的,摘掉。 */
            const firstUser = transcript.blocks.find((b) => b.role === "user");
            if (firstUser?.text.includes(GEN_TASK_MARK)) return { id: row.id ?? "", part: null };
            return { id: row.id ?? "", part: renderSessionDigest(row, transcript.blocks) };
          } catch {
            return { id: row.id ?? "", part: null };
          }
        }),
      ),
    );
  }
  const body: string[] = [];
  const coveredIds: string[] = [];
  let used = 0;
  let skipped = 0;
  for (const { id, part } of parts) {
    if (part === null) continue;
    if (used + part.length > DAY_CHAR_CAP) {
      skipped += 1;
      continue;
    }
    coveredIds.push(id);
    body.push(part);
    used += part.length;
  }
  if (skipped > 0) body.push("(超出全日预算,部分会话摘录省略)");
  const md = body.length
    ? `# 会话内容摘录\n\n> tmd-cli 自动生成:每节一个会话的用户原话、助手结论、关键动作与报错,是当日文章的事实来源。\n\n${body.join("\n")}`
    : "";
  return { md, coveredIds, covered: coveredIds.length, total: rows.length };
}
