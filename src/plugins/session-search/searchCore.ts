/**
 * 检索纯函数面(indexer.ts 拆件,文件规模铁则)——命中结构/时间窗/分词/
 * 片段/子串检索/引擎过滤/行级定位目标构造,全部零 IO,可独立单测。
 * 数据契约(SessionIndexEntry/SessionIndex)与索引器留在 ./indexer。
 */

import type { SessionIndex, SessionIndexEntry } from "./indexer";

/** 命中结果:条目 + 首个命中消息的片段(含前后文窗口)。 */
export interface SessionSearchHit {
  entry: SessionIndexEntry;
  snippet: string;
  /** snippet 所中心的命中词(<mark> 高亮锚:纯文本切三段拼 React 节点用)。 */
  matchToken: string;
  /** 命中发生在标题(优先展示)。 */
  inTitle: boolean;
  /** 命中的用户消息全文(标题命中无正文 = undefined;行级定位 needle 源)。 */
  message?: string;
  /** 同一会话内全部消息命中(子命中展开列表,042 随手带;截顶 SUB_HIT_CAP)。 */
  subHits: SessionSubHit[];
}

/** 子命中:单条命中消息的片段 + 定位 needle(消息全文,跳该处用)。 */
export interface SessionSubHit {
  snippet: string;
  matchToken: string;
  /** 命中消息全文(行级定位 needle 源,与首命中 message 同口径)。 */
  message: string;
}

/** 子命中展开上限:防病态长会话撑爆浮层(超出部分计数仍含在条目标题里)。 */
export const SUB_HIT_CAP = 20;

/** 检索时间窗(闭区间,按条目 modifiedAt 过滤;缺省端 = 该侧不限)。 */
export interface SessionTimeRange {
  fromMs?: number;
  toMs?: number;
}

/** 时间 chip 静态枚举:键 → 回溯时长(ms);all = 0 表示不限窗。 */
export const TIME_FILTER_MS = {
  all: 0,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
  "30d": 30 * 24 * 60 * 60_000,
} as const;

export type TimeFilterKey = keyof typeof TIME_FILTER_MS;

/** chip 键 → 查询窗(nowMs 注入保纯;all = undefined 即不过滤)。 */
export function timeRangeFor(key: TimeFilterKey, nowMs: number): SessionTimeRange | undefined {
  const span = TIME_FILTER_MS[key];
  return span > 0 ? { fromMs: nowMs - span } : undefined;
}

/** 查询分词:空白切分(多关键词 AND —— 全命中才算一条;大小写不敏感)。 */
function tokenizeQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** 匹配片段:最早命中点前后各取 ~60 字符,边界补省略号;
 *  返回所中心的 token(高亮拆分锚;无命中回落首词)。 */
function snippetOf(
  text: string,
  tokens: readonly string[],
): { snippet: string; matchToken: string } {
  let at = -1;
  let matchToken = tokens[0] ?? "";
  for (const tk of tokens) {
    const i = text.toLowerCase().indexOf(tk);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      matchToken = tk;
    }
  }
  if (at < 0) return { snippet: text.slice(0, 120), matchToken };
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + matchToken.length + 60);
  return {
    snippet: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
    matchToken,
  };
}

/**
 * 子串检索(大小写不敏感,多关键词空格分词全命中 AND):标题命中优先,
 * 其余按最近修改排序,截前 limit 条。O(条目 × 消息) 内存扫描,千级会话语义下
 * 毫秒级,不值得 FTS5(041 裁决缓行)。
 */
export function searchSessions(
  index: SessionIndex,
  query: string,
  limit = 50,
  range?: SessionTimeRange,
): SessionSearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const hits: SessionSearchHit[] = [];
  for (const entry of index.entries) {
    /* 时间谓词(闭区间,等值命中):只按 modifiedAt 判,零索引结构改动 */
    if (range?.fromMs != null && entry.modifiedAt < range.fromMs) continue;
    if (range?.toMs != null && entry.modifiedAt > range.toMs) continue;
    const lowerTitle = entry.title?.toLowerCase();
    const inTitle = lowerTitle ? tokens.every((tk) => lowerTitle.includes(tk)) : false;
    /* 子命中:全量扫描收集(消息全文在内存,纯展示层重组,零 IO);
     * 首条即原 snippet/matchToken 来源,展示契约不变。 */
    const subHits: SessionSubHit[] = [];
    for (const m of entry.messages) {
      const lm = m.toLowerCase();
      if (!tokens.every((tk) => lm.includes(tk))) continue;
      const snip = snippetOf(m, tokens);
      if (subHits.length < SUB_HIT_CAP) subHits.push({ snippet: snip.snippet, matchToken: snip.matchToken, message: m });
    }
    const first = subHits[0];
    if (!inTitle && !first) continue;
    const message = first?.message;
    hits.push({
      entry,
      snippet: message ? first.snippet : (entry.title ?? ""),
      matchToken: message ? first.matchToken : tokens[0],
      inTitle,
      message,
      subHits,
    });
  }
  /* 先排序后限量:标题命中必须浮出,不能被先到的消息命中挤掉配额 */
  hits.sort((a, b) => {
    if (a.inTitle !== b.inTitle) return a.inTitle ? -1 : 1;
    return b.entry.modifiedAt - a.entry.modifiedAt;
  });
  return hits.slice(0, limit);
}

/**
 * 浮层命中管线第二层:引擎过滤 chip 叠加在(时间窗过滤后的)结果集上。
 * 选中的引擎不在集合 = 查询/时间已变,视为未选恒等返回。
 */
export function applyFilters(
  rawHits: SessionSearchHit[],
  engineFilter: string | null,
): SessionSearchHit[] {
  if (engineFilter == null) return rawHits;
  return rawHits.some((h) => h.entry.profileId === engineFilter)
    ? rawHits.filter((h) => h.entry.profileId === engineFilter)
    : rawHits;
}

/** 命中 → 行级定位入参(kernel anchorJump.openThenJumpToText 的 target 与
 *  needle 文本);cwd/workspaceId 直接取条目(跨区跳转先切后跳的数据源);
 *  标题命中无消息原文返回 null = 只开会话不定位。
 *  sub = 子命中展开列表里点的那一处(042 随手带):跳该处而非首命中;
 *  缺省回落首命中(主行 Enter/点击语义不变)。 */
export function locateTargetOf(
  hit: SessionSearchHit,
  sub?: SessionSubHit,
): {
  target: { profileId: string; cwd: string; workspaceId?: string; cliSessionId: string };
  text: string;
} | null {
  const entry: SessionIndexEntry = hit.entry;
  const message = sub?.message ?? hit.message;
  if (!message) return null;
  return {
    target: {
      profileId: entry.profileId,
      cwd: entry.cwd,
      workspaceId: entry.workspaceId,
      cliSessionId: entry.cliSessionId,
    },
    text: message,
  };
}
