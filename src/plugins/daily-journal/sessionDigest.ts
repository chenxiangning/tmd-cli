/**
 * 会话内容摘录 —— 每日文章的内容提取层(2026-09-30 重构;2026-10-06 压缩原语
 * 下沉 kernel/transcriptDigest,本模块只留小节头装配与全日编排)。
 *
 * 旧路径只给生成会话一份标题清单,靠 agent 自行只读探测 7 家 CLI 的原始 jsonl 成文,
 * 格式异构导致普遍放弃 → 文章只剩标题复述。现改为:tmd 侧经各 CLI 插件声明的
 * readSessionTranscript 适配器(session-viewer 同款先例)读出角色化块,压缩成当日
 * 摘录文件落盘;生成会话以摘录为事实来源成文。行型知识仍在各家族插件内,本模块
 * 只做块级压缩,不碰任何 CLI 私有格式。
 */
import { host } from "@kernel/host";
import type { CliTranscriptBlock } from "@kernel/cli";
import { renderTranscriptDigest, DIGEST_CAPS, type DigestCaps } from "@kernel/transcriptDigest";
import type { DaySessionRow } from "./daySessions";
import { GEN_TASK_MARK } from "./promptGen";
import { hmOf } from "./timeUtil";


/** 全日摘录字符预算:超出停止收录(24 会话 × 4KB 也用不满)。 */
export const DAY_CHAR_CAP = 100_000;

/** 单会话块列表 → 摘录小节(md;空内容返回 null,调用方按仅标题处理)。 */
export function renderSessionDigest(
  row: DaySessionRow,
  blocks: CliTranscriptBlock[],
  caps: DigestCaps = DIGEST_CAPS,
): string | null {
  const digest = renderTranscriptDigest(blocks, caps);
  if (!digest) return null;
  const head = `### ${hmOf(row.startedAt)} [${row.profileId}] ${row.title}${row.wsName ? `(${row.wsName})` : ""}`;
  return [head, ...digest.lines, ""].join("\n");
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
    if (i > 0) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 0);
      await promise;
    }
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
