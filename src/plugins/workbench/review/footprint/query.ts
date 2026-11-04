/**
 * footprint 读侧聚合:日明细 / 月热力 / 区间汇总 / ⌘K 四来源搜索 / 功能卡校验。
 * 全部现场经 getMonth(与写侧共享月缓存)与 fsReadFile 读 journal 产物;损坏宽容跳过。
 */
import { ipc } from "@kernel/ipc";
import { dailyPaths } from "@plugins/workbench/journal/journalFiles";
import { getMonth, featuresPath } from "./rollup";
import { emptyUserLayer, isEmptyLayer, mergeLayer, migrateV1, type MergedCard, type UserCardsFile } from "./userLayer";
import {
  emptyDay, pad2,
  type FeatureCard, type FeatureCardFile, type FootprintDay, type FpFileStat, type FpSessionEntry,
} from "./types";

/** 当日明细:文件按 refs 数降序(证据密度优先)。 */
export interface DayDetail {
  day: string;
  sessions: Record<string, FpSessionEntry>;
  files: FpFileStat[];
  batches: Record<string, string>;
}

export async function dayDetail(ym: string, dd: string): Promise<DayDetail> {
  const month = await getMonth(ym);
  const day: FootprintDay = month.days[dd] ?? emptyDay();
  const files: FpFileStat[] = Object.entries(day.files)
    .map(([path, f]) => ({ path, add: f.add, del: f.del, cfg: f.cfg, refs: f.refs }))
    .sort((a, b) => b.refs.length - a.refs.length || a.path.localeCompare(b.path));
  return { day: dd, sessions: day.sessions, files, batches: day.batches };
}

/** 月历热力格:每日 {净增, 加, 删, 会话数};无活动日缺席。 */
export interface HeatCell {
  dd: string;
  net: number;
  add: number;
  del: number;
  sessionCount: number;
}

export async function monthHeat(ym: string): Promise<HeatCell[]> {
  const month = await getMonth(ym);
  return Object.entries(month.days).map(([dd, day]) => {
    let add = 0;
    let del = 0;
    for (const f of Object.values(day.files)) {
      add += f.add;
      del += f.del;
    }
    return { dd, net: add - del, add, del, sessionCount: Object.keys(day.sessions).length };
  }).sort((a, b) => a.dd.localeCompare(b.dd));
}

/** 区间聚合(含端点;跨月按 ym-dd 字典序)。 */
export interface RangeSummary {
  add: number;
  del: number;
  files: Set<string>;
  /** cwd → {add, del}(按会话归属工作区)。 */
  cwdBreakdown: Record<string, { add: number; del: number }>;
}

export async function range(ymA: string, ddA: string, ymB: string, ddB: string): Promise<RangeSummary> {
  const start = `${ymA}-${ddA}`;
  const end = `${ymB}-${ddB}`;
  const months = monthSpan(ymA, ymB);
  const out: RangeSummary = { add: 0, del: 0, files: new Set(), cwdBreakdown: {} };
  const loadedMonths = await Promise.all(months.map((m) => getMonth(m)));
  for (let mi = 0; mi < months.length; mi++) {
    const ym = months[mi];
    const month = loadedMonths[mi];
    for (const [dd, day] of Object.entries(month.days)) {
      const key = `${ym}-${dd}`;
      if (key < start || key > end) continue;
      for (const path of Object.keys(day.files)) {
        const f = day.files[path];
        out.add += f.add;
        out.del += f.del;
        out.files.add(path);
      }
      /* cwd 归因:文件记首引用会话的工作区(单会话写入为主流,不按 refs 摊分) */
      for (const f of Object.values(day.files)) {
        const cwd = day.sessions[f.refs[0]]?.cwd;
        if (!cwd) continue;
        const slot = out.cwdBreakdown[cwd] ?? { add: 0, del: 0 };
        slot.add += f.add;
        slot.del += f.del;
        out.cwdBreakdown[cwd] = slot;
      }
    }
  }
  return out;
}

/** 闭区间月份清单(ym 递增;入参倒序自动换向,跨年自然进位)。 */
export function monthSpan(ymA: string, ymB: string): string[] {
  if (ymA > ymB) [ymA, ymB] = [ymB, ymA];
  const [ya, ma] = ymA.split("-").map(Number);
  const [yb, mb] = ymB.split("-").map(Number);
  const out: string[] = [];
  for (let y = ya, m = ma; y < yb || (y === yb && m <= mb);) {
    out.push(`${y}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/* ── 功能卡校验(防编造:sessions 逐个对照当日会话枚举) ── */

/** 解析并校验功能卡档;未命中引用的卡标 unverified;档缺失/损坏/version 不符 = null。 */
export function validateFeatureCards(
  json: unknown,
  knownSessionIds: ReadonlySet<string>,
): { cards: (FeatureCard & { unverified: boolean })[] } | null {
  const file = json as FeatureCardFile | null;
  if (!file || file.version !== 1 || !Array.isArray(file.cards)) return null;
  return {
    cards: file.cards.map((card) => ({
      ...card,
      unverified: card.sessions.some((sid) => !knownSessionIds.has(sid)),
    })),
  };
}

/* ── ⌘K 搜索:当月 ± 前后月 rollup + features + journal article/digest ── */

export type SearchKind = "card" | "quote" | "article" | "path";

export interface SearchHit {
  day: string;
  kind: SearchKind;
  snippet: string;
  /** 命中功能卡在其档内下标(card/quote 源)。 */
  featureId?: number;
}

const SNIPPET_LEN = 80;

function clip(line: string, needle: string): string {
  const at = line.toLowerCase().indexOf(needle);
  const from = Math.max(0, at - 20);
  const cut = line.slice(from, from + SNIPPET_LEN).trim();
  return from > 0 ? `…${cut}` : cut;
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await ipc.fsReadFile(path);
  } catch {
    return null;
  }
}

/** 当日功能卡档读取结果:origin 供徽标区分 AI 归纳/用户修正/纯手动;
 *  merged 逐卡带来源(AI 原卡/用户改后/手动新增),ai/layer 供修正层差量写盘。 */
export interface FeatureCardsRead {
  file: FeatureCardFile;
  origin: "ai" | "user-edited" | "manual";
  ai: FeatureCard[] | null;
  layer: UserCardsFile;
  merged: MergedCard[];
}

/** 用户档宽容判型:v2 差量层直用;v1 整量快照按标题对账迁移;其余=空层(不吞 AI 卡)。 */
function toUserLayer(raw: unknown, ai: FeatureCard[] | null): UserCardsFile {
  const r = raw as (Partial<UserCardsFile> & Partial<FeatureCardFile>) | null;
  if (r && r.version === 2 && r.overrides && Array.isArray(r.hidden) && Array.isArray(r.added)) {
    return r as unknown as UserCardsFile;
  }
  if (r && r.version === 1 && Array.isArray(r.cards)) {
    return migrateV1(r.cards as FeatureCard[], ai);
  }
  return emptyUserLayer();
}

/** 当日功能卡档;AI 与修正层双层合并(v2 差量语义,旧 v1 档读时自动迁移):
 *  修正层 = 按 AI 原标题的 overrides + 显式 hidden tombstone + 手动 added;
 *  任一层缺失/损坏宽容降级(修正层损坏 = 空层,AI 卡不受牵连)。 */
export async function readFeatureCards(day: string): Promise<FeatureCardsRead | null> {
  const aiPath = await featuresPath(day);
  const userPath = aiPath.replace(/\.json$/, ".user.json");
  const readJson = async (path: string): Promise<unknown | null> => {
    try {
      return JSON.parse(await ipc.fsReadFile(path)) as unknown;
    } catch {
      return null;
    }
  };
  const aiRaw = await readJson(aiPath);
  const aiFile =
    aiRaw && (aiRaw as FeatureCardFile).version === 1 && Array.isArray((aiRaw as FeatureCardFile).cards)
      ? (aiRaw as FeatureCardFile)
      : null;
  const ai = aiFile?.cards ?? null;
  const userRaw = await readJson(userPath);
  const layer = toUserLayer(userRaw, ai);
  const merged = mergeLayer(ai, layer);
  if (!aiFile && userRaw == null) return null;
  const origin = aiFile ? (isEmptyLayer(layer) ? "ai" : "user-edited") : "manual";
  return { file: { version: 1, cards: merged.map((m) => m.card) }, origin, ai, layer, merged };
}

/** 四来源搜索,按日分组。now 决定当月(测试可注入)。 */
export async function searchFootprint(
  query: string,
  now: Date = new Date(),
): Promise<Record<string, SearchHit[]>> {
  const q = query.toLowerCase();
  if (!q) return {};
  const needle = q;
  const ym = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  const months = monthSpan(shiftMonth(ym, -1), shiftMonth(ym, 1));
  const journal = await dailyPaths();
  const byDay: Record<string, SearchHit[]> = {};

  /* 先取全月(并行),再并行逐日扫(日间无依赖);byDay 装配保持按日升序。 */
  const monthFiles = await Promise.all(months.map((m) => getMonth(m)));
  const days: { full: string; files: { path: string; add: number; del: number }[] }[] = [];
  for (const [mi, m] of months.entries()) {
    for (const [dd, day] of Object.entries(monthFiles[mi].days)) {
      days.push({ full: `${m}-${dd}`, files: Object.entries(day.files).map(([path, f]) => ({ path, add: f.add, del: f.del })) });
    }
  }

  const perDay = await Promise.all(days.map(async ({ full, files }) => {
    const hits: SearchHit[] = [];
    for (const { path, add, del } of files) {
      if (path.toLowerCase().includes(needle)) {
        hits.push({ day: full, kind: "path", snippet: `+${add} −${del} ${path}` });
      }
    }
    /* 功能卡:标题/一句话 → card;用户原话 → quote */
    const featureRead = await readFeatureCards(full);
    if (featureRead) {
      featureRead.file.cards.forEach((card, i) => {
        if (`${card.title} ${card.summary}`.toLowerCase().includes(needle)) {
          hits.push({ day: full, kind: "card", snippet: card.summary, featureId: i });
        } else if (card.quote && card.quote.text.toLowerCase().includes(needle)) {
          hits.push({ day: full, kind: "quote", snippet: clip(card.quote.text, needle), featureId: i });
        }
      });
    }
    /* journal 摘录(digest)→ quote(用户原话锚点);日报文章 → article */
    const digest = await readTextOrNull(journal.digest(...dayParts(full)));
    if (digest) scanLines(digest, needle, (line) => hits.push({ day: full, kind: "quote", snippet: clip(line, needle) }));
    const article = await readTextOrNull(journal.article(...dayParts(full)));
    if (article) scanLines(article, needle, (line) => hits.push({ day: full, kind: "article", snippet: clip(line, needle) }));
    return hits;
  }));
  for (const [i, { full }] of days.entries()) {
    if (perDay[i].length > 0) byDay[full] = perDay[i];
  }
  return byDay;
}

/** "YYYY-MM-DD" → [y, m, d](dailyPaths 闭包入参)。 */
function dayParts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d];
}

/** 行级包含即命中(每文只记首条命中行,避免洪水)。 */
function scanLines(text: string, needle: string, hit: (line: string) => void): void {
  for (const line of text.split("\n")) {
    if (line.toLowerCase().includes(needle)) {
      hit(line);
      return;
    }
  }
}

/** 月份加减(溢出自然进位/退位)。 */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad2((total % 12) + 1)}`;
}
