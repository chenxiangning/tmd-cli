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
  /** 会话身份:磁盘 = 该家族会话 id,活 = app 会话 id;摘录收录标注按它对齐。 */
  id?: string;
  /** 会话开始时刻(ms epoch;磁盘缺 createdAt 回落 modifiedAt)。 */
  startedAt: number;
  /** 最近活动时刻(ms epoch;时长展示用)。 */
  modifiedAt: number;
  live: boolean;
  wsName: string;
  /** 磁盘形态(活会话去重命中时也挂载):转录适配器的取数凭证,摘录层消费。 */
  disk?: CliDiskSession;
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
    id: disk.id,
    title: disk.title || disk.id.slice(0, 8),
    startedAt: disk.createdAt ?? disk.modifiedAt,
    modifiedAt: disk.modifiedAt,
    live: false,
    wsName: ws.name,
    disk,
  };
}

/** 活会话行(纯函数,测试面);kind cli 才进索引,开始时刻缺回落当前时刻。 */
export function liveRow(meta: SessionMeta, wsName: string): DaySessionRow | null {
  if (meta.kind && meta.kind !== "cli") return null;
  const started = meta.createdAt ?? Date.now();
  return {
    profileId: meta.engine || meta.profileId,
    id: meta.id,
    title: meta.title || meta.id,
    startedAt: started,
    modifiedAt: started,
    live: true,
    wsName,
  };
}

/** 磁盘扫描中间形态(缓存与 hook state 共用):磁盘行 + 活会话磁盘凭证;
 *  活行装配留给渲染层按当前活会话表即时重算(见 assembleRows)。 */
export interface DiskScan {
  diskRows: DaySessionRow[];
  liveDisk: Map<string, CliDiskSession>;
}

const EMPTY_SCAN: DiskScan = { diskRows: [], liveDisk: new Map() };

/** 活行装配(纯函数,测试面):磁盘行 + 活会话表 → 完整行集。孤儿活会话
 *  (工作区集外)不混入;命中磁盘身份挂 disk 凭证,活行 modifiedAt 停在 spawn
 *  时刻会误判「已归纳」,以磁盘最近写入为准取大。 */
export function assembleRows(
  diskRows: DaySessionRow[],
  liveDisk: Map<string, CliDiskSession>,
  metas: SessionMeta[],
  wsNames: Map<string, string>,
): DaySessionRow[] {
  const out = diskRows.slice();
  for (const m of metas) {
    if (m.workspaceId && !wsNames.has(m.workspaceId)) continue;
    const row = liveRow(m, m.workspaceId ? (wsNames.get(m.workspaceId) ?? "") : "");
    if (!row) continue;
    const key = m.cliSessionId ? `${m.workspaceId ?? ""}:${m.engine || m.profileId}:${m.cliSessionId}` : null;
    const disk = key ? liveDisk.get(key) : undefined;
    if (disk) {
      row.disk = disk;
      row.modifiedAt = Math.max(row.modifiedAt, disk.modifiedAt);
    }
    out.push(row);
  }
  return out;
}

/** 批式全量收集(磁盘 + 活;genSession/journalSchedule 经 collectSessionRows 直用)。
 *  onBatch 缺省 = 纯全量一次返回;传入则每个 (工作区×家族) 落定即回调累计中间形态,
 *  done/total 为扫描进度,done===total 的那次回调即完整 DiskScan(单线程时序保证)。 */
export async function collectSessionRowsBatched(
  workspaces: Workspace[] | undefined,
  onBatch?: (scan: DiskScan, done: number, total: number) => void,
): Promise<DaySessionRow[]> {
  const target = workspaces ?? getWorkspaces().filter((w) => !findWorkspaceOrigin(w)?.remoteExec);
  if (target.length === 0) return [];
  const profiles = host.getCliProfiles().filter((p) => p.listSessions);
  const metas = host.getSessions();
  const liveKeys = new Set(
    metas
      .map((m) => (m.cliSessionId ? `${m.workspaceId ?? ""}:${m.engine || m.profileId}:${m.cliSessionId}` : null))
      .filter((k): k is string => k !== null),
  );
  /* 活会话已落盘(omp 首条消息即落盘):按绑定身份去重,活形态优先,disk 凭证挂到活行。 */
  const scan: DiskScan = { diskRows: [], liveDisk: new Map() };
  const total = target.length * profiles.length;
  let done = 0;
  await Promise.all(
    target.flatMap((ws) =>
      profiles.map((p) =>
        p
          .listSessions!(ws.root)
          .catch(() => [] as CliDiskSession[])
          .then((list) => {
            for (const disk of list) {
              const key = `${ws.id}:${p.id}:${disk.id}`;
              if (liveKeys.has(key)) scan.liveDisk.set(key, disk);
              else scan.diskRows.push(diskRow(ws, p.id, disk));
            }
            done++;
            onBatch?.({ diskRows: scan.diskRows.slice(), liveDisk: new Map(scan.liveDisk) }, done, total);
          }),
      ),
    ),
  );
  const wsNames = new Map(target.map((w) => [w.id, w.name]));
  return assembleRows(scan.diskRows, scan.liveDisk, metas, wsNames);
}

/** 非批全量(直用面兼容封装)。 */
export function collectSessionRows(workspaces?: Workspace[]): Promise<DaySessionRow[]> {
  return collectSessionRowsBatched(workspaces);
}

/* 扫描缓存:ArticleTab/主视图/右栏面板共用一份(TTL+liveKey 内免重扫;refreshTick>0
   旁路)。存中间形态 DiskScan,活行装配下放渲染层 —— 活会话开关只触发内存重合并,
   不再等重扫才反映到当日格。ponytail: TTL 只在 effect 实跑时咨询——外部落盘的标题
   变更需等下次触发(切 tab/活会话变化/手点重扫)才收敛,60s 非保证上界)。 */
const SCAN_TTL_MS = 60_000;
let scanCache: { wsKey: string; liveKey: string; scan: DiskScan; at: number } | null = null;

/** 日索引 hook 视图:days null = 冷启动尚无任何数据;
 *  progress = 分批扫描进度(空态文案消费)。 */
export interface DaySessionsView {
  days: Map<string, DaySessionRow[]> | null;
  progress: { done: number; total: number } | null;
}

/** 日索引 hook。旧数据先上屏:挂载遇同工作区集旧缓存立即渲染,后台重扫静默换新
 *  (stale-while-revalidate);扫描走批式逐 (工作区×家族) 渐进上屏;活行按 liveKey
 *  在渲染层即时重合并,活会话开关不等磁盘扫描。活会话表变化/刷新 tick 触发重扫。 */
export function useDaySessions(workspaces: Workspace[], refreshTick: number): DaySessionsView {
  useHost(); /* 订阅面:活会话表变化重渲染(liveKey 进下述 effect/useMemo deps)。 */
  const liveKey = host.getSessions().map((m) => m.id).join(",");
  const wsKey = useMemo(() => workspaces.map((w) => w.id).sort().join(","), [workspaces]);
  const [scan, setScan] = useState<DiskScan | null>(() =>
    scanCache && scanCache.wsKey === wsKey ? scanCache.scan : null,
  );
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (workspaces.length === 0) {
      setScan(EMPTY_SCAN);
      setProgress(null);
      return;
    }
    const cached = scanCache?.wsKey === wsKey ? scanCache : null;
    if (cached) setScan(cached.scan); /* 旧数据先上屏(缓存新鲜时同引用幂等) */
    if (refreshTick === 0 && cached && cached.liveKey === liveKey && Date.now() - cached.at < SCAN_TTL_MS) {
      setProgress(null);
      return;
    }
    let alive = true;
    let last: DiskScan | null = null;
    void collectSessionRowsBatched(workspaces, (batch, done, total) => {
      if (!alive) return;
      last = batch;
      setScan(batch); /* 逐批装配,渐进上屏 */
      setProgress({ done, total });
    }).then(() => {
      if (!alive) return;
      if (last) scanCache = { wsKey, liveKey, scan: last, at: Date.now() };
      setProgress(null);
    });
    return () => {
      alive = false;
    };
    // workspaces 由 wsKey 表征(引用每渲染可新,不进 deps)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsKey, refreshTick, liveKey]);
  const wsNames = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);
  /* getSessions 返回稳定数组引用(变更才换引用),作依赖即「活表变化即时重合并」。 */
  const metas = host.getSessions();
  const days = useMemo(
    () => (scan ? groupByDay(assembleRows(scan.diskRows, scan.liveDisk, metas, wsNames)) : null),
    [scan, metas, wsNames],
  );
  return useMemo(() => ({ days, progress }), [days, progress]);
}

/** 今日 key(本地时区)。 */
export function todayKey(): string {
  const d = new Date();
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
