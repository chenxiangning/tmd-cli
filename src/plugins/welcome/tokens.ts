/**
 * token 用量聚合(纯函数层)—— 从各 CLI 会话 JSONL 头部窗口提取 usage 行,
 * 聚合为「按引擎 + 按日 + 总计」。行型实盘实证(2026-09-11):
 * - omp/pi:`message.usage` = {input, output, cacheRead, cacheWrite, cost.total},
 *   顶层 timestamp ISO;逐行累加。
 * - claude:`message.usage` = {input_tokens, output_tokens,
 *   cache_creation_input_tokens, cache_read_input_tokens},顶层 timestamp;逐行累加。
 * - codex:`type:"event_msg"` + `payload.type:"token_count"` + `payload.info.total_token_usage`
 *   是**会话累计快照**,只取末次(累加会翻倍)。
 * 仅读头窗口(与 extractJsonlTitle 同策略):usage 行集中在会话头部?不 ——
 * assistant 行贯穿全文。这里读头 256KB 是妥协窗口,早期会话代表大头的绝大
 * 多数(长会话后段是短往返)。ponytail: 头窗口近似,全文扫描待用量数据被
 * 证明需要时再说。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliProfile } from "@kernel/cli";

/** 头窗口字节数(与 diskSessions 的深窗一致)。 */
const HEAD_BYTES = 256 * 1024;
/** 7 日窗口 ms。 */
export const WINDOW_MS = 7 * 86400_000;

/** 单条 usage 行(归一后)。 */
export interface UsageLine {
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
}

/** 单会话提取结果:lines = 窗口内归一行;codex 快照已折成单行。 */
export interface SessionUsage {
  lines: UsageLine[];
}

/** 按引擎聚合行。hasUsage=false = 该引擎行型未知/无数据,UI 显 —。 */
export interface EngineUsage {
  profileId: string;
  hasUsage: boolean;
  totalIn: number;
  totalOut: number;
  totalCache: number;
  cost?: number;
}

/** 按日聚合(仅 in/out,趋势柱用)。 */
export interface DailyUsage {
  dayKey: string; // YYYY-MM-DD(本地时区)
  totalIn: number;
  totalOut: number;
}

/** dashboard 顶层聚合。 */
export interface TokenAgg {
  byEngine: EngineUsage[];
  daily: DailyUsage[];
  totals: { input: number; output: number; cacheRead: number; cost: number };
  /** 窗口内消费过的会话数。 */
  sessions: number;
}

/** profile id → 展示名(引擎行用)。 */
export interface EngineLabel {
  id: string;
  name: string;
}

/* ── 行型解析(纯函数,可测)────────────────────────── */

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** ISO 时间串 → ms;非法 = null。 */
function parseTs(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 单行 JSON → UsageLine | null。三家行型分派:
 * omp/pi 与 claude 走 message.usage(字段名不同),codex 走 event_msg/token_count。
 * codex 返回 { line, snapshot: true } 标记快照语义(调用方只留末次)。
 */
export function parseUsageLine(
  json: unknown,
): { line: UsageLine; snapshot: boolean } | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const msg = o.message as Record<string, unknown> | undefined;

  /* omp/pi + claude:message.usage */
  if (msg && typeof msg.usage === "object" && msg.usage !== null) {
    const ts = parseTs(o.timestamp) ?? parseTs(msg.completedAt);
    if (ts === null) return null;
    const u = msg.usage as Record<string, unknown>;
    /* claude 字段名(_tokens 后缀)与 omp/pi 短名并存,两读。 */
    const input = num(u.input_tokens) || num(u.input);
    const output = num(u.output_tokens) || num(u.output);
    if (input === 0 && output === 0) return null; // 全零行(错误行)不产数据
    const costObj = u.cost as Record<string, unknown> | undefined;
    return {
      snapshot: false,
      line: {
        ts,
        input,
        output,
        cacheRead: num(u.cache_read_input_tokens) || num(u.cacheRead),
        cacheWrite: num(u.cache_creation_input_tokens) || num(u.cacheWrite),
        cost: costObj ? num(costObj.total) || undefined : undefined,
      },
    };
  }

  /* codex:event_msg/token_count.info.total_token_usage 累计快照 */
  if (o.type === "event_msg") {
    const p = o.payload as Record<string, unknown> | undefined;
    if (!p || p.type !== "token_count") return null;
    const info = p.info as Record<string, unknown> | undefined;
    const t = info?.total_token_usage as Record<string, unknown> | undefined;
    if (!t) return null;
    const ts = parseTs(o.timestamp);
    if (ts === null) return null;
    const input = num(t.input_tokens);
    const output = num(t.output_tokens) + num(t.reasoning_output_tokens);
    if (input === 0 && output === 0) return null;
    return {
      snapshot: true,
      line: {
        ts,
        input,
        output,
        cacheRead: num(t.cached_input_tokens),
        cacheWrite: num(t.cache_write_input_tokens),
      },
    };
  }

  return null;
}

/**
 * 头窗口文本 → SessionUsage。codex 快照:同会话只留 ts 最大的一条;
 * 其余逐行累加语义由调用方聚合。窗口外(startMs 前的)行丢弃。
 */
export function extractUsageFromHead(head: string, startMs: number): SessionUsage {
  const lines: UsageLine[] = [];
  let snap: UsageLine | null = null;
  for (const raw of head.split("\n")) {
    const s = raw.trim();
    if (!s || !s.includes("usage") && !s.includes("token_count")) continue;
    let json: unknown;
    try {
      json = JSON.parse(s);
    } catch {
      continue;
    }
    const parsed = parseUsageLine(json);
    if (!parsed) continue;
    if (parsed.line.ts < startMs) continue;
    if (parsed.snapshot) {
      /* codex 累计快照:留末次 */
      if (!snap || parsed.line.ts >= snap.ts) snap = parsed.line;
    } else {
      lines.push(parsed.line);
    }
  }
  if (snap) lines.push(snap);
  return { lines };
}

/* ── 聚合(纯函数,可测)──────────────────────────── */

const dayKeyOf = (ts: number): string => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 空引擎行(hasUsage=false,UI 显 —)。 */
const emptyEngine = (profileId: string): EngineUsage => ({
  profileId,
  hasUsage: false,
  totalIn: 0,
  totalOut: 0,
  totalCache: 0,
});

/**
 * 聚合入口:profiles × sessions(已按 profile 分组)→ TokenAgg。
 * daily 恒补齐 7 天(无消费日 = 0 柱,trend 不开天窗)。
 */
export function aggregateUsage(
  now: number,
  labels: readonly EngineLabel[],
  sessionsByProfile: Readonly<Record<string, readonly (CliDiskSession | { path: string })[]>>,
  usageBySession: Readonly<Record<string, UsageLine[]>>,
): TokenAgg {
  const byEngine: Record<string, EngineUsage> = {};
  const dailyMap: Record<string, DailyUsage> = {};
  const totals = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  let sessions = 0;

  for (const label of labels) byEngine[label.id] = emptyEngine(label.id);

  for (const [profileId, sessions_] of Object.entries(sessionsByProfile)) {
    const eng = byEngine[profileId] ?? emptyEngine(profileId);
    for (const s of sessions_) {
      const lines = usageBySession[s.path] ?? [];
      if (lines.length === 0) continue;
      sessions += 1;
      eng.hasUsage = true;
      for (const l of lines) {
        eng.totalIn += l.input + l.cacheRead + l.cacheWrite;
        eng.totalOut += l.output;
        eng.totalCache += l.cacheRead + l.cacheWrite;
        if (l.cost) eng.cost = (eng.cost ?? 0) + l.cost;
        totals.input += l.input;
        const key = dayKeyOf(l.ts);
        const day = dailyMap[key] ?? { dayKey: key, totalIn: 0, totalOut: 0 };
        day.totalIn += l.input + l.cacheRead + l.cacheWrite;
        day.totalOut += l.output;
        dailyMap[key] = day;
        totals.output += l.output;
        totals.cacheRead += l.cacheRead;
        if (l.cost) totals.cost += l.cost;
      }
    }
    byEngine[profileId] = eng;
  }

  /* daily 恒 7 天,升序。 */
  const daily: DailyUsage[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKeyOf(now - i * 86400_000);
    daily.push(dailyMap[key] ?? { dayKey: key, totalIn: 0, totalOut: 0 });
  }

  return {
    byEngine: labels.map((l) => byEngine[l.id] ?? emptyEngine(l.id)),
    daily,
    totals,
    sessions,
  };
}

/* ── IO 编排(薄)──────────────────────────────────── */

/**
 * 扫描全工作区 × 全 profile 的近 7 日用量。
 * 任一会话读失败 → 跳过;profile listSessions 失败 → 该引擎 hasUsage=false。
 */
export async function collectTokenUsage(
  profiles: readonly CliProfile[],
  workspaces: readonly { root: string }[],
): Promise<{ agg: TokenAgg; labels: EngineLabel[] } | null> {
  const now = Date.now();
  const startMs = now - WINDOW_MS;
  const labels: EngineLabel[] = profiles.map((p) => ({ id: p.id, name: p.name }));
  const sessionsByProfile: Record<string, (CliDiskSession | { path: string })[]> = {};
  const usageBySession: Record<string, UsageLine[]> = {};
  const reads: Promise<void>[] = [];

  await Promise.all(
    profiles.map(async (profile) => {
      if (!profile.listSessions) return;
      const per: { path: string }[] = [];
      await Promise.all(
        workspaces.map(async (ws) => {
          const sessions = await profile
            .listSessions!(ws.root)
            .catch(() => [] as CliDiskSession[]);
          for (const s of sessions) {
            if (s.modifiedAt < startMs) continue; // 7 日窗口外
            per.push(s);
            reads.push(
              ipc
                .fsReadHead(s.path, HEAD_BYTES)
                .then((head) => {
                  usageBySession[s.path] = extractUsageFromHead(head, startMs).lines;
                })
                .catch(() => undefined), // 单会话失败跳过
            );
          }
        }),
      );
      if (per.length > 0) sessionsByProfile[profile.id] = per;
    }),
  );

  await Promise.all(reads);
  return { agg: aggregateUsage(now, labels, sessionsByProfile, usageBySession), labels };
}
