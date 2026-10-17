/**
 * token 用量聚合(聚合层)—— 纯行型解析已下沉 cli-shared/sessionUsage
 * (session-search 联合消费,2026-09-26);本文件保留窗口常量、按引擎/按日
 * 聚合与 IO 编排。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import {
  extractUsageFromHead,
  type UsageLine,
} from "../cli-shared/sessionUsage";
import { windowResetFor } from "./quotaWindow";


/** 头窗口字节数(与 diskSessions 的深窗一致)。 */
const HEAD_BYTES = 256 * 1024;
/** claude 窗口推算的尾窗字节数:覆盖最近 5h 活动的 usage 行(≈250+ 条)。 */
const TAIL_BYTES = 128 * 1024;
/** 7 日窗口 ms。 */
export const WINDOW_MS = 7 * 86400_000;

/** 按引擎聚合行。hasUsage=false = 该引擎行型未知/无数据,UI 显 —。 */
interface EngineUsage {
  profileId: string;
  hasUsage: boolean;
  totalIn: number;
  totalOut: number;
  totalCache: number;
  cost?: number;
}

/** 按日聚合(仅 in/out,趋势柱用)。 */
interface DailyUsage {
  dayKey: string; // YYYY-MM-DD(本地时区)
  totalIn: number;
  totalOut: number;
}

/** profile id → 展示名(引擎行用)。 */
export interface EngineLabel {
  id: string;
  name: string;
}

/** dashboard 顶层聚合。 */
export interface TokenAgg {
  byEngine: EngineUsage[];
  daily: DailyUsage[];
  totals: { input: number; output: number; cacheRead: number; cost: number };
  /** 窗口内消费过的会话数。 */
  sessions: number;
  /** 限额窗口重置推算(profileId → 推算结果;只对有行的 profile 键,
   * 口径未知的家族值为 null)。 */
  windows: Record<string, { startMs: number; resetAtMs: number } | null>;
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

  /* 限额窗口推算:按 profile 收拢全量行(usageBySession 经 path 关联),
   * 只对有行的 profile 键;口径未知的家族 windowResetFor 返回 null。 */
  const linesByProfile: Record<string, UsageLine[]> = {};
  for (const [profileId, sessions_] of Object.entries(sessionsByProfile)) {
    for (const s of sessions_) {
      const lines = usageBySession[s.path];
      if (!lines || lines.length === 0) continue;
      (linesByProfile[profileId] ??= []).push(...lines);
    }
  }
  const windows: TokenAgg["windows"] = {};
  for (const [profileId, lines] of Object.entries(linesByProfile)) {
    const w = windowResetFor(profileId, lines, now);
    windows[profileId] = w ? { startMs: w.windowStartMs, resetAtMs: w.resetAtMs } : null;
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
    windows,
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
  /* claude 窗口推算专用尾读:usage 行追加在文件尾,>HEAD_BYTES 的长会话头部
   * 只有过期行,窗口推算必须吃尾(claude 无额度 API,只能本地推算)。 */
  const usageTailBySession: Record<string, UsageLine[]> = {};

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
                  usageBySession[s.path] = extractUsageFromHead(head, startMs);
                })
                .catch(() => undefined), // 单会话失败跳过
            );
            if (profile.id === "claude") {
              reads.push(
                ipc
                  .fsReadTail(s.path, TAIL_BYTES)
                  .then((tail) => {
                    usageTailBySession[s.path] = extractUsageFromHead(tail, startMs);
                  })
                  .catch(() => undefined),
              );
            }
          }
        }),
      );
      if (per.length > 0) sessionsByProfile[profile.id] = per;
    }),
  );

  await Promise.all(reads);
  const agg = aggregateUsage(now, labels, sessionsByProfile, usageBySession);
  /* claude 窗口以尾读行精化(尾读空则退回头读结果):tail 行覆盖最近活动,
   * 推算锚点不再受长会话文件头截断影响。 */
  const claude = profiles.find((p) => p.id === "claude");
  if (claude) {
    const tailLines = Object.values(usageTailBySession).flat();
    if (tailLines.length > 0) {
      const w = windowResetFor("claude", tailLines, now);
      agg.windows["claude"] = w
        ? { startMs: w.windowStartMs, resetAtMs: w.resetAtMs }
        : null;
    }
  }
  return { agg, labels };
}
