/**
 * 手机 home 磁盘历史扫描 —— 复用桌面 cli-* 插件的会话扫描器(同源适配器,
 * 零格式知识复制);RPC 走 transport 的 fs 只读面(fs_collect_files / fs_read_head /
 * fs_list_dir / fs_read_file 均在 AppDevice 白名单),桌面侧无需任何新命令面。
 *
 * 范围:jsonl/目录型引擎全覆盖;opencode(sqlite 代读)与 dsh(host sqlite)的
 * 历史不在 AppDevice 放行域,手机端不显示(活会话仍由 session_list 覆盖)。
 * 活会话行与磁盘行同列不合并(与桌面侧栏同语义:活行 + 磁盘行并存)。
 */

import type { CliDiskSession } from "@kernel/cli";
import { piFamilySessions } from "@plugins/cli-shared/piFamily";
import { listQoderSessions } from "@plugins/cli-shared/qoderSessionModel";
import { ompSessionsDir } from "@plugins/cli-omp/edits";
import { piSessionsDir } from "@plugins/cli-pi/edits";
import { listClaudeSessions } from "@plugins/cli-claude/sessions";
import { listCodexSessions } from "@plugins/cli-codex/sessions";
import { listKimiSessions } from "@plugins/cli-kimi/kimiSessions";
import { listGrokSessions } from "@plugins/cli-grok/sessions";
import type { RemoteSession, RemoteWorkspace } from "./remote";

/** 各引擎磁盘扫描器(与桌面 CliProfile.listSessions 同源;cwd = 工作区 root)。 */
const SCANNERS: Record<string, (cwd: string) => Promise<CliDiskSession[]>> = {
  omp: piFamilySessions({ sessionsDir: ompSessionsDir }).listSessions,
  pi: piFamilySessions({ sessionsDir: piSessionsDir }).listSessions,
  claude: listClaudeSessions,
  codex: listCodexSessions,
  kimi: listKimiSessions,
  grok: listGrokSessions,
  qoder: (cwd) => listQoderSessions(".qoder", cwd),
  "qoder-cn": (cwd) => listQoderSessions(".qoder-cn", cwd),
};

/** 一条磁盘历史:引擎 id + 扫描产物。 */
export interface HistoryItem {
  profileId: string;
  session: CliDiskSession;
}

/** 扫一个工作区的全部引擎磁盘历史;单引擎失败 = 该引擎空,不阻塞其余。 */
export async function scanWorkspaceHistory(root: string): Promise<HistoryItem[]> {
  const lists = await Promise.all(
    Object.entries(SCANNERS).map(async ([profileId, scan]) => [
      profileId,
      await scan(root).catch(() => [] as CliDiskSession[]),
    ] as const),
  );
  return lists.flatMap(([profileId, sessions]) =>
    sessions.map((session) => ({ profileId, session })),
  );
}

/** home 行:活会话(可进实况屏)或磁盘历史(只读 transcript)。 */
export interface HomeRow {
  key: string;
  kind: "live" | "disk";
  profileId: string;
  title: string;
  /** 排序与相对时间展示用:活 = createdAt,磁盘 = modifiedAt。 */
  ts: number;
  live?: RemoteSession;
  disk?: CliDiskSession;
}

/** home 分组:全部工作区(含无会话的)+ 未归属桶,行按时间倒序。 */
export function groupHomeRows(args: {
  workspaces: RemoteWorkspace[];
  sessions: RemoteSession[];
  /** key = 工作区 root(scanWorkspaceHistory 的调用参数)。 */
  history: Map<string, HistoryItem[]>;
  q: string;
  titleOfLive: (s: RemoteSession) => string;
  titleOfDisk: (h: HistoryItem) => string;
}): { wsId: string; name: string; rows: HomeRow[] }[] {
  const needle = args.q.trim().toLowerCase();
  const hit = (t: string) => !needle || t.toLowerCase().includes(needle);

  const byWs = new Map<string, RemoteSession[]>();
  for (const s of args.sessions) {
    const wsId = s.workspaceId ?? "default";
    const list = byWs.get(wsId);
    if (list) list.push(s);
    else byWs.set(wsId, [s]);
  }

  const wsName = new Map(args.workspaces.map((w) => [w.id, w.name] as const));
  const groups: { wsId: string; name: string; rows: HomeRow[]; latest: number }[] = [];

  for (const w of args.workspaces) {
    const rows: HomeRow[] = [];
    for (const s of byWs.get(w.id) ?? []) {
      const title = args.titleOfLive(s);
      if (!hit(title)) continue;
      rows.push({
        key: `live:${s.id}`,
        kind: "live",
        profileId: s.profileId,
        title,
        ts: s.createdAt ?? 0,
        live: s,
      });
    }
    for (const h of args.history.get(w.root) ?? []) {
      const title = args.titleOfDisk(h);
      if (!hit(title)) continue;
      rows.push({
        key: `disk:${h.profileId}:${h.session.id}`,
        kind: "disk",
        profileId: h.profileId,
        title,
        ts: h.session.modifiedAt ?? h.session.createdAt ?? 0,
        disk: h.session,
      });
    }
    rows.sort((a, b) => b.ts - a.ts);
    groups.push({
      wsId: w.id,
      name: w.name,
      rows,
      latest: rows[0]?.ts ?? 0,
    });
  }

  /* 配置外/未归属的活会话桶(shell、跨机 cwd 不在配置里等)。 */
  for (const [wsId, list] of byWs) {
    if (args.workspaces.some((w) => w.id === wsId)) continue;
    const rows: HomeRow[] = list.flatMap((s) => {
      const title = args.titleOfLive(s);
      if (!hit(title)) return [];
      return [{
        key: `live:${s.id}`,
        kind: "live" as const,
        profileId: s.profileId,
        title,
        ts: s.createdAt ?? 0,
        live: s,
      }];
    });
    rows.sort((a, b) => b.ts - a.ts);
    if (rows.length) {
      groups.push({ wsId, name: wsName.get(wsId) ?? wsId, rows, latest: rows[0].ts });
    }
  }

  /* 有内容的组按最近活动倒序,空组随后按配置顺序。 */
  return groups
    .sort((a, b) => (a.rows.length && b.rows.length ? b.latest - a.latest : a.rows.length ? -1 : b.rows.length ? 1 : 0))
    .map(({ wsId, name, rows }) => ({ wsId, name, rows }));
}

/** 归档覆盖层 key(与桌面 kernel/sessionArchive key 同构;活会话无磁盘身份,恒本地)。 */
export function diskArchiveKey(wsId: string, r: HomeRow): string {
  return `${wsId}:${r.profileId}:${r.disk?.id ?? ""}`;
}

/** 工作区行按归档视图切分:local = 活行 + 未归档磁盘行;archive = 归档磁盘行。 */
export function partitionByArchive(
  rows: HomeRow[],
  wsId: string,
  archive: Set<string>,
): { local: HomeRow[]; archived: HomeRow[] } {
  const local: HomeRow[] = [];
  const archived: HomeRow[] = [];
  for (const r of rows) {
    if (r.kind === "disk" && archive.has(diskArchiveKey(wsId, r))) archived.push(r);
    else local.push(r);
  }
  return { local, archived };
}

/** 置顶 key(与桌面 sessionOverlayKey 同构;活行取注册表 cliSessionId,磁盘行取扫描 id)。 */
export function pinKeyOf(wsId: string, r: HomeRow): string | null {
  const cid = r.kind === "live" ? r.live?.cliSessionId : r.disk?.id;
  return cid ? `${wsId}:${r.profileId}:${cid}` : null;
}
/** home 顶部两区:运行中 = 全部活会话(跨工作区,新在上);
 *  已置顶 = pins 覆盖层命中的行(置顶时间升序 = 最早置顶最上,与桌面同律)。 */
export function topZones(args: {
  groups: { wsId: string; name: string; rows: HomeRow[] }[];
  pins: Record<string, { pinnedAt?: number }>;
}): { running: HomeRow[]; pinned: HomeRow[] } {
  const running: HomeRow[] = [];
  const pinned: Array<{ row: HomeRow; at: number }> = [];
  for (const g of args.groups) {
    for (const r of g.rows) {
      if (r.kind === "live") running.push(r);
      const pk = pinKeyOf(g.wsId, r);
      if (pk && pk in args.pins) pinned.push({ row: r, at: args.pins[pk].pinnedAt ?? 0 });
    }
  }
  running.sort((a, b) => b.ts - a.ts);
  pinned.sort((a, b) => a.at - b.at);
  return { running, pinned: pinned.map((p) => p.row) };
}
