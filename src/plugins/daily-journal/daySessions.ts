/**
 * 按日会话索引 —— listSessions 磁盘扫描 + 活会话合并,按「会话开始日」归日
 * (跨零点晚归会话归前一日,与原型一致)。扫描形态沿用 session-board/useBoardSessions
 */
import { useEffect, useMemo, useState } from "react";
import { host, useHost } from "@kernel/host";
import type { CliDiskSession } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";
import { getWorkspaces, type Workspace } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { dayKey } from "./journalFiles";

/** 一条进入日索引的会话(磁盘或活)。 */
export interface DaySessionRow {
  profileId: string;
  title: string;
  /** 会话开始时刻(ms epoch;磁盘缺 createdAt 回落 modifiedAt)。 */
  startedAt: number;
  /** 最近活动时刻(ms epoch;时长展示用)。 */
  modifiedAt: number;
  live: boolean;
  wsName: string;
}

/** 纯聚合:行 → 日索引(Map key = YYYY-MM-DD,行内按开始时刻升序)。 */
export function groupByDay(rows: DaySessionRow[]): Map<string, DaySessionRow[]> {
  const map = new Map<string, DaySessionRow[]>();
  for (const r of rows) {
    const d = new Date(r.startedAt);
    const k = dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  for (const list of map.values()) list.sort((a, b) => a.startedAt - b.startedAt);
  return new Map([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** 增量判定(纯函数,测试面):行最近活动 ≤ 上次成功生成抓取清单的水位 = 已并入文章。
 *  水位未定(该日尚无成功生成)恒 false —— 无从归纳,不标。 */
export function isRowSummarized(row: DaySessionRow, summarizedAt: number | undefined): boolean {
  return summarizedAt !== undefined && row.modifiedAt <= summarizedAt;
}

/** 磁盘行装配(纯函数,测试面)。 */
export function diskRow(
  ws: Workspace,
  profileId: string,
  disk: CliDiskSession,
): DaySessionRow {
  return {
    profileId,
    title: disk.title || disk.id.slice(0, 8),
    startedAt: disk.createdAt ?? disk.modifiedAt,
    modifiedAt: disk.modifiedAt,
    live: false,
    wsName: ws.name,
  };
}

/** 活会话行(纯函数,测试面);kind cli 才进索引,开始时刻缺回落当前时刻。 */
export function liveRow(meta: SessionMeta, wsName: string): DaySessionRow | null {
  if (meta.kind && meta.kind !== "cli") return null;
  const started = meta.createdAt ?? Date.now();
  return {
    profileId: meta.engine || meta.profileId,
    title: meta.title || meta.id,
    startedAt: started,
    modifiedAt: started,
    live: true,
    wsName,
  };
}

/** 全量收集(磁盘 + 活,去重/归属过滤;genSession 直用非 hook 面)。
 *  目标工作区集缺省 = 全部非远端工作区。 */
export async function collectSessionRows(workspaces?: Workspace[]): Promise<DaySessionRow[]> {
  const target = workspaces ?? getWorkspaces().filter((w) => !findWorkspaceOrigin(w)?.remoteExec);
  if (target.length === 0) return [];
  const profiles = host.getCliProfiles().filter((p) => p.listSessions);
  const liveKeys = new Set(
    host
      .getSessions()
      .map((m) => (m.cliSessionId ? `${m.workspaceId ?? ""}:${m.engine || m.profileId}:${m.cliSessionId}` : null))
      .filter((k): k is string => k !== null),
  );
  const out: DaySessionRow[] = [];
  await Promise.all(
    target.flatMap((ws) =>
      profiles.map((p) =>
        p
          .listSessions!(ws.root)
          .catch(() => [] as CliDiskSession[])
          .then((list) => {
            /* 活会话已落盘(omp 首条消息即落盘):按绑定身份去重,活形态优先。 */
            for (const disk of list) {
              if (!liveKeys.has(`${ws.id}:${p.id}:${disk.id}`)) out.push(diskRow(ws, p.id, disk));
            }
          }),
      ),
    ),
  );
  /* 活会话按目标工作区集过滤(孤儿活会话不混入;先例 boardRows.mergeLive)。 */
  const liveById = new Map(target.map((w) => [w.id, w.name]));
  for (const m of host.getSessions()) {
    if (m.workspaceId && !liveById.has(m.workspaceId)) continue;
    const row = liveRow(m, m.workspaceId ? (liveById.get(m.workspaceId) ?? "") : "");
    if (row) out.push(row);
  }
  return out;
}

/* 扫描缓存:ArticleTab/主视图/右栏面板共用一份(TTL+liveKey 内免重扫;refreshTick>0
   旁路。ponytail: TTL 只在 effect 实跑时咨询——外部落盘的标题变更需等下次
   触发(切 tab/活会话变化/手点重扫)才收敛,60s 非保证上界)。 */
const SCAN_TTL_MS = 60_000;
let scanCache: { wsKey: string; liveKey: string; rows: DaySessionRow[]; at: number } | null = null;

/** 日索引 hook(null = 扫描中)。活会话表变化/刷新 tick 触发重扫。 */
export function useDaySessions(workspaces: Workspace[], refreshTick: number): Map<string, DaySessionRow[]> | null {
  useHost(); /* 订阅面:活会话表变化重渲染(liveKey 进下述 effect deps)。 */
  const liveKey = host.getSessions().map((m) => m.id).join(",");
  const wsKey = useMemo(() => workspaces.map((w) => w.id).sort().join(","), [workspaces]);
  const [rows, setRows] = useState<DaySessionRow[] | null>(null);
  useEffect(() => {
    if (workspaces.length === 0) {
      setRows([]);
      return;
    }
    const fresh =
      refreshTick === 0 &&
      scanCache &&
      scanCache.wsKey === wsKey &&
      scanCache.liveKey === liveKey &&
      Date.now() - scanCache.at < SCAN_TTL_MS;
    if (fresh) {
      setRows(scanCache?.rows ?? []);
      return;
    }
    let alive = true;
    void collectSessionRows(workspaces).then((out) => {
      if (!alive) return;
      scanCache = { wsKey, liveKey, rows: out, at: Date.now() };
      setRows(out);
    });
    return () => {
      alive = false;
    };
    // workspaces 由 wsKey 表征(引用每渲染可新,不进 deps)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsKey, refreshTick, liveKey]);
  return useMemo(() => (rows ? groupByDay(rows) : null), [rows]);
}

/** 今日 key(本地时区)。 */
export function todayKey(): string {
  const d = new Date();
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
