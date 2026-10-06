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
import { pruneLru, readCache, writeCache } from "./diskCache";

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
/** 时间线磁盘缓存(Record<sessionKey, 条目>,LRU 10;sessionKey = profileId:cliSessionId)。
 *  text 存 clipText 后形态(锚安全:clipText 幂等,loadHistoryRange 再 clip 不变形)。 */
const TL_KEY = "tmd.m.tl.v1";
const TL_LRU = 10;

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

/** 渐进回调签名(loadTimelineAll 与增量扫描共用)。 */
type PartialCb = (
  entries: TimelineEntry[],
  progress: { loaded: number; total: number; path: string },
) => void;

/** 时间线缓存条目:scannedSize = 扫描时文件尺寸(截断判定),entries 按文件序。 */
interface TimelineCacheEntry {
  path: string;
  scannedSize: number;
  entries: TimelineEntry[];
  at: number;
}

function readTimelineCache(key: string): TimelineCacheEntry | null {
  return readCache<Record<string, TimelineCacheEntry>>(TL_KEY)?.[key] ?? null;
}

/** 单会话缓存字节封顶:entries 按文件序从最旧端丢弃(锚取末条,丢最旧不破坏
 *  增量正确性;UI 本就是「最近一段」语义)。重度会话数千条 ×0.7KB 曾把 TL blob
 *  顶过 WebView ~5MB 配额,连带逐空兄弟缓存(2026-10-06 评审 P1)。 */
const TL_SESSION_BYTES = 512 * 1024;

function writeTimelineCache(
  key: string,
  path: string,
  scannedSize: number,
  entries: TimelineEntry[],
): void {
  const all = readCache<Record<string, TimelineCacheEntry>>(TL_KEY) ?? {};
  /* 自尾向头累计(锚取末条 = 最新端必留):O(n) 定裁剪点,免整串反复 stringify。 */
  const keptRev: TimelineEntry[] = [];
  let budget = TL_SESSION_BYTES;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = { ...entries[i], text: clipText(entries[i].text) };
    const cost = JSON.stringify(e).length + 1;
    if (keptRev.length > 0 && cost > budget) break;
    keptRev.push(e);
    budget -= cost;
  }
  const kept = keptRev.reverse();
  all[key] = { path, scannedSize, at: Date.now(), entries: kept };
  writeCache(TL_KEY, pruneLru(all, TL_LRU));
}

/** 增量边界校验:缓存末条 offset 处首行解析回同 id = 锚有效;
 *  resume 换新文件/截断续写/他端改写全拦下转全量。空缓存 = 通过(从 0 正向扫)。 */
async function anchorMatches(
  path: string,
  cached: TimelineCacheEntry,
  parser: UserMessageLineParser,
): Promise<boolean> {
  const last = cached.entries[cached.entries.length - 1];
  if (!last) return true;
  try {
    /* 锚行长尾:末条用户消息贴大段日志/代码 >4KB 常态,小窗首行必截断 →
     *  锚恒失败退化全量;64KB 与 HIST 分段同量级(2026-10-06 评审 P2)。 */
    const span = await ipc.fsReadRange(path, last.offset, 65_536);
    const hit = parser(JSON.parse(span.text.split("\n", 1)[0]) as Record<string, unknown>);
    return hit?.id === last.id;
  } catch {
    return false;
  }
}

/** 段内逐行解析合入(自尾向头/增量正向两路共用):行字节 offset = 段基 + 累计
 *  (TextEncoder 算真字节,防 UTF-8 偏差);parser 吃已解析 JSON,坏行跳过。 */
function collectLines(
  text: string,
  base: number,
  parser: UserMessageLineParser,
  enc: TextEncoder,
  seen: Set<string>,
  entries: TimelineEntry[],
): void {
  let lineStart = base;
  for (const line of text.split("\n")) {
    const lineBytes = enc.encode(line).length + 1; /* +1 = \n */
    if (line.startsWith("{")) {
      try {
        const hit = parser(JSON.parse(line) as Record<string, unknown>);
        if (hit && !seen.has(hit.id)) {
          seen.add(hit.id);
          entries.push({ ...hit, offset: lineStart });
        }
      } catch {
        /* 写一半的活会话行/段界残行 */
      }
    }
    lineStart += lineBytes;
  }
}

/** 增量路:自缓存末条 offset(空缓存从 0;起点即行首)向文件尾正向分段扫 [from,total),
 *  seen 去重合入,onPartial 照发;超段数护栏 = capped(已扫部分照回写)。 */
async function scanForward(
  path: string,
  from: number,
  total: number,
  parser: UserMessageLineParser,
  enc: TextEncoder,
  seen: Set<string>,
  entries: TimelineEntry[],
  onPartial?: PartialCb,
): Promise<boolean> {
  let pos = from;
  for (let seg = 0; pos < total; seg++) {
    if (seg >= MAX_SEGMENTS) return true;
    const span = await ipc.fsReadRange(path, pos, SEG_BYTES);
    if (span.consumed === 0) {
      /* 整段无换行(单行 > SEG_BYTES 的巨型消息):快进,该条不进时间线。 */
      pos += SEG_BYTES;
      continue;
    }
    collectLines(span.text, pos, parser, enc, seen, entries);
    pos += span.consumed;
    entries.sort((a, b) => a.offset - b.offset);
    onPartial?.([...entries], { loaded: Math.min(pos, total), total, path });
  }
  return false;
}

/** 渐进拉全程(桌面时间线 = 首拍全量;手机 = 自尾向头分段,新条目先见面):
 *  onPartial 每段一发(条目按文件序最旧在前,UI 反转显示;path 随首个 partial
 *  到达,渐进期条目即可跳转);返回 null = 未找到会话文件(jsonl 懒落盘,可
 *  重试);reject = 读取失败(UI 保留已到的 partial)。
 *  2026-10-06 缓存+增量:命中且锚校验通过 → 从末条 offset 正向扫增量;
 *  截断/校验败/无缓存 → 自尾向头全程;两条路完成都回写磁盘缓存。 */
export async function loadTimelineAll(
  profileId: string,
  cwd: string,
  cliSessionId: string,
  onPartial?: PartialCb,
): Promise<{ path: string; entries: TimelineEntry[]; capped: boolean } | null> {
  const parser = PARSERS[profileId.toLowerCase()];
  if (!parser) return null; /* 入口已置灰,防御性不猜文件 */
  const cacheKey = `${profileId}:${cliSessionId}`;
  const cached = readTimelineCache(cacheKey);
  let probe: { size: number } | null = null;
  let path = await resolveTranscriptPath(profileId, cwd, undefined, cliSessionId);
  if (!path && cached) {
    /* 「查不到」补救:resolve 落空(懒落盘/身份竞态)时缓存 path 探活,
     * 探活帧顺手拿 size(治外网一例:文件在但定位链失败)。 */
    probe = await ipc.fsReadTailChanged(cached.path, 0, null).catch(() => null);
    if (probe) path = cached.path;
  }
  if (!path) return null;
  probe ??= await ipc.fsReadTailChanged(path, 0, null); /* 0 字节读只拿 size */
  const total = probe.size;
  const enc = new TextEncoder();
  const seen = new Set<string>();
  const entries: TimelineEntry[] = [];
  /* 增量路:缓存在场 && 文件未缩(截断 = 全量) && 末条锚校验通过。 */
  if (cached && total >= cached.scannedSize && (await anchorMatches(path, cached, parser))) {
    for (const e of cached.entries) {
      seen.add(e.id);
      entries.push(e);
    }
    /* 缓存条目立即上屏(外网首拍零等待),增量段随后续发。 */
    const from = cached.entries.length ? cached.entries[cached.entries.length - 1].offset : 0;
    onPartial?.([...entries], { loaded: Math.min(from, total), total, path });
    const capped = await scanForward(path, from, total, parser, enc, seen, entries, onPartial);
    writeTimelineCache(cacheKey, path, total, entries);
    return { path, entries, capped };
  }
  /* 全量路:自尾向头分段全程(新条目先见面)。 */
  let start = total;
  let capped = false;
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
    collectLines(span.text, reqStart, parser, enc, seen, entries);
    entries.sort((a, b) => a.offset - b.offset); /* 尾→头扫描,合入后归位文件序 */
    onPartial?.([...entries], { loaded: total - start, total, path });
  }
  writeTimelineCache(cacheKey, path, total, entries);
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
