/**
 * 时间线数据层(spec 2026-10-05-mobile-session-timeline;2026-10-05 二轮改全程)——
 * 组件文件只出组件(react-doctor only-export-components,先例 shared.ts):
 * 定位 jsonl(resolveTranscriptPath 按会话身份精确绑定)→ fs_read_range 自尾向头
 * 分段全程扫描(桌面 messageAnchors full 首拍语义的手机复刻),每条用户消息记
 * 行字节 offset(跳转定位锚,重复文本各自精确绑定);行型知识全部 cli-shared/
 * cli-kimi 已导出件,IO 经 ipc→桥→Rust FS_READ 白名单(fs_read_range 新原语)。
 */
import type { CliUserMessage } from "@kernel/cli";
import type { TranscriptTurn } from "@kernel/transcript";
import { clipText } from "@kernel/transcript";
import { ipc } from "@kernel/ipc";
import {
  claudeUserMessageLine,
  codexUserMessageLine,
  ompPiUserMessageLine,
  type UserMessageLineParser,
} from "@plugins/cli-shared/userMessages";
import { kimiUserMessageLine } from "@plugins/cli-kimi/kimiSessions";
import { parseTurnsFromText, resolveTranscriptPath } from "./sessionFile";

/** 分段大小(真机实证 2026-10-05:响应帧 JSON 转义 + 中继 b64 ×1.33 膨胀,
 *  段原文 ≤384KB → 封包 ≈1MB,稳过手机壳 4MiB 收帧上限与 invoke 15s 强断)。 */
const SEG_BYTES = 384 * 1024;
/** 段数护栏(64 段 × 384KB = 24MB):超出停扫,UI 注记「已显示最近 24MB 内条目」。
 *  桌面 messageAnchors 是 32MB 内存全量口径;手机外网流量受限,取同级上限。 */
const MAX_SEGMENTS = 64;
/** 历史定位段上下文:目标消息前 64KB(上文几轮)后 768KB(后续走向),
 *  单次 invoke ≈832KB 原文,封包安全同上。 */
const HIST_BEFORE = 64 * 1024;
const HIST_AFTER = 768 * 1024;

/** 行型 parser 分发(支持面与 resolveTranscriptPath 同构;qoder/grok 未进手机
 *  transcript 契约 → 不在表 = 不支持,诚实降级不猜测)。 */
const PARSERS: Record<string, UserMessageLineParser> = {
  omp: ompPiUserMessageLine,
  pi: ompPiUserMessageLine,
  claude: claudeUserMessageLine,
  cl: claudeUserMessageLine,
  codex: codexUserMessageLine,
  kimi: kimiUserMessageLine,
};

/** 时间线条目:offset = 消息行在 jsonl 的起始字节(历史定位段的锚)。 */
export interface TimelineEntry extends CliUserMessage {
  offset: number;
}

/** 引擎是否支持时间线(PlusPanel 第五格置灰判据)。 */
export function timelineSupported(profileId: string | undefined): boolean {
  return !!profileId && profileId.toLowerCase() in PARSERS;
}

/** 渐进拉全程(桌面时间线 = 首拍全量;手机 = 自尾向头分段,新条目先见面):
 *  onPartial 每段一发(条目按文件序最旧在前,UI 反转显示;path 随首个 partial
 *  到达,渐进期条目即可跳转);返回 null = 未找到会话文件(jsonl 懒落盘,可
 *  重试);reject = 读取失败(UI 保留已到的 partial)。 */
export async function loadTimelineAll(
  profileId: string,
  cwd: string,
  cliSessionId: string,
  onPartial?: (
    entries: TimelineEntry[],
    progress: { loaded: number; total: number; path: string },
  ) => void,
): Promise<{ path: string; entries: TimelineEntry[]; capped: boolean } | null> {
  const parser = PARSERS[profileId.toLowerCase()];
  if (!parser) return null; /* 入口已置灰,防御性不猜文件 */
  const path = await resolveTranscriptPath(profileId, cwd, undefined, cliSessionId);
  if (!path) return null;
  const probe = await ipc.fsReadTailChanged(path, 0, null); /* 0 字节读只拿 size */
  const total = probe.size;
  let start = total;
  let capped = false;
  const enc = new TextEncoder();
  const seen = new Set<string>();
  const entries: TimelineEntry[] = [];
  for (let seg = 0; start > 0 && total > 0; seg++) {
    if (seg >= MAX_SEGMENTS) {
      capped = true;
      break;
    }
    const reqStart = Math.max(0, start - SEG_BYTES);
    const span = await ipc.fsReadRange(path, reqStart, SEG_BYTES);
    if (span.consumed === 0) {
      /* 整段无换行(单行 > SEG_BYTES 的巨型消息):快进到段首,段首残行由
       * JSON 解析失败自然丢弃,行尾对齐自行恢复;该条不进时间线。 */
      start = reqStart;
      continue;
    }
    /* 段完整消费(consumed = want):EOF 段归 reqStart、段边界恰逢行尾归
       reqStart+want,两支都=继续读前面;consumed < want = 段尾残行,下段从
       残行起点重读。保留区 = [reqStart, reqStart+consumed),行解析以 reqStart 为基。 */
    const want = Math.min(SEG_BYTES, total - reqStart);
    start = span.consumed === want ? reqStart : reqStart + span.consumed;
    /* 段内逐行:行字节 offset = 段基 + 累计(TextEncoder 算真字节,防 UTF-8 偏差);
     * parser 吃已解析 JSON(与 readUserMessagesFromFile 同律),坏行跳过。 */
    let lineStart = reqStart;
    for (const line of span.text.split("\n")) {
      const lineBytes = enc.encode(line).length + 1; /* +1 = \n */
      if (line.startsWith("{")) {
        try {
          const hit = parser(JSON.parse(line) as Record<string, unknown>);
          if (hit && !seen.has(hit.id)) {
            seen.add(hit.id);
            entries.push({ ...hit, offset: lineStart });
          }
        } catch {
          /* 写一半的活会话行/段首残行 */
        }
      }
      lineStart += lineBytes;
    }
    entries.sort((a, b) => a.offset - b.offset); /* 尾→头扫描,合入后归位文件序 */
    onPartial?.([...entries], { loaded: total - start, total, path });
  }
  return { path, entries, capped };
}

/** 历史定位段(桌面 jumpToAnchor「不在 buffer 时逐页加载」的手机对应):
 *  目标消息 offset 前后文一段快照解析成 turns;锚文本 = 消息原文 clipText 归一
 *  (与 turns 解析同口径,DOM 匹配两侧一致)。 */
export async function loadHistoryRange(
  path: string,
  message: TimelineEntry,
): Promise<{ turns: TranscriptTurn[]; anchorText: string }> {
  const from = Math.max(0, message.offset - HIST_BEFORE);
  const span = await ipc.fsReadRange(path, from, HIST_BEFORE + HIST_AFTER);
  return { turns: parseTurnsFromText(span.text), anchorText: clipText(message.text) };
}
