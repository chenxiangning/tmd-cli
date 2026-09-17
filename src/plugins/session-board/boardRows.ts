/**
 * 会话看板 —— 行装配纯函数层(自 boardData 拆出,守 300 行铁则)。
 * mergeDisk:磁盘行 + 覆盖层(归档/删除/改名);mergeLive:活会话现推导。
 * 消费方:boardData.useBoardSessions。
 */
import { host } from "@kernel/host";
import type { SessionMeta } from "@kernel/ipc";
import { getSessionBaseline } from "@kernel/sessionTabs";
import { sessionArchiveKey, type SessionArchiveEntry } from "@kernel/sessionArchive";
import { isSessionDeleted, sessionDeletedKey } from "@kernel/sessionDeleted";
import { sessionTitleKey } from "@kernel/sessionTitles";
import { workspaceDisplayName, type Workspace } from "@kernel/workspace";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import {
  type BoardSession,
  type BoardState,
} from "./boardData";

/** 未查看年龄阈:超期未归档会话按已查看处理(注意力面只管近期)。 */
const UNSEEN_WINDOW_MS = 14 * 24 * 3600_000;
/** 查看→归档瞬态窗(生命周期 2026-09-17 定义):归档落定后此窗内显示
 *  「结束-已查看」,期满转「已归档」——已查看是短暂临时态,看完直接归档。 */
const VIEWED_FLASH_MS = 2_400;

/** 扫描扁平行:归属工作区随行进(全部工作区视图下归档/删除 key 要逐行自己的 ws)。 */
export interface ScanEntry {
  ws: Workspace;
  profile: CliProfile;
  disk: CliDiskSession;
}

function resolveTitle(
  profileId: string,
  cliSessionId: string | undefined,
  titles: Record<string, string>,
  liveBaseline: string | undefined,
  diskTitle: string | undefined,
  fallbackId: string,
): string {
  if (cliSessionId) {
    const named = titles[sessionTitleKey(profileId, cliSessionId)];
    if (named) return named;
  }
  return liveBaseline ?? diskTitle ?? fallbackId.slice(0, 8);
}

/** 磁盘 + 覆盖层装配(扫描结果与设置变更时重算);活会话部分每次渲染现推导。 */
export function mergeDisk(
  entries: ScanEntry[],
  titles: Record<string, string>,
  archive: Record<string, SessionArchiveEntry>,
): BoardSession[] {
  const now = Date.now();
  const rows: BoardSession[] = [];
  for (const { ws, profile, disk } of entries) {
    if (isSessionDeleted(sessionDeletedKey(ws.id, profile.id, disk.id))) continue;
    /* 归档标记存在即已归档;落定后 VIEWED_FLASH_MS 内显示瞬态「结束-已查看」。
     * 标记跨打开/关闭持久(归档→打开→关闭→再归档往返靠它成立,勿按年龄回落)。 */
    const entry = archive[sessionArchiveKey(ws.id, profile.id, disk.id)];
    const st: BoardState = entry
      ? now - entry.archivedAt < VIEWED_FLASH_MS
        ? "ended-seen"
        : "archived"
      : now - disk.modifiedAt < UNSEEN_WINDOW_MS
        ? "ended-new"
        : "ended-seen";
    rows.push({
      key: `${ws.id}:${profile.id}:${disk.id}`,
      profile,
      profileId: profile.id,
      cliSessionId: disk.id,
      wsId: ws.id,
      wsName: workspaceDisplayName(ws),
      wsRoot: ws.root,
      title: resolveTitle(profile.id, disk.id, titles, undefined, disk.title, disk.id),
      ts: disk.createdAt ?? disk.modifiedAt,
      activeTs: disk.modifiedAt,
      st,
      live: false,
      disk,
    });
  }
  return rows;
}

/** 活会话首见时刻(无磁盘无 createdAt 的兜底,防渲染漂移)。 */
const LIVE_FIRST_SEEN = new Map<string, number>();
/** 活会话装配:有 CLI profile 的会话才入板(shell/纯 SSH 终端不进)。
 *  归属 = workspaceId 命中或 cwd 前缀命中任一传入工作区;全部工作区视图下
 *  不属于任何工作区的孤儿活会话也收(「全部」即全部,wsName 落 cwd 目录名)。 */
export function mergeLive(
  workspaces: Workspace[],
  /** 全部工作区视图:孤儿活会话(不属于任何已知工作区)也收;单工作区视图过滤。 */
  allMode: boolean,
  titles: Record<string, string>,
  entries: ScanEntry[],
): BoardSession[] {
  /* Map 查找替代线性 find(grok 2455 会话 × 每渲染的量级,评审 P2);
     key = profileId:cliId → 归属工作区优先,跨工作区同 id 取第一命中。 */
  const diskById = new Map<string, ScanEntry[]>();
  for (const e of entries) {
    const k = `${e.profile.id}:${e.disk.id}`;
    const arr = diskById.get(k);
    if (arr) arr.push(e);
    else diskById.set(k, [e]);
  }
  const liveIds = new Set<string>();
  const rows: BoardSession[] = [];
  const wsById = new Map(workspaces.map((w) => [w.id, w]));
  for (const meta of host.getSessions() as SessionMeta[]) {
    liveIds.add(meta.id);
    /* profile 逐会话活查:cli-* 插件在 activate 期才注册 profile,本模块求值早于
     * 一切 activate —— 模块级快照必为空 Map,活会话(running/idle 两道)整条死路
     * (2026-09-17 生产序探针实证)。注册表 O(1) 查找,活会话量级下零成本。 */
    const profile = host.getCliProfile(meta.engine ?? meta.profileId);
    if (!profile) continue;
    if (meta.kind === "shell") continue;
    /* 会话归属工作区:meta.workspaceId 缺省(内建 spawn 前期)按 cwd 前缀判,
     * 补分隔符避免 /repo 误配 /repo-2(侧栏严格 workspaceId,此处仅兜底口径)。 */
    let own = meta.workspaceId ? wsById.get(meta.workspaceId) : undefined;
    if (!own && !meta.workspaceId) {
      for (const w of workspaces) {
        if ((meta.cwd + "/").startsWith(w.root + "/")) {
          own = w;
          break;
        }
      }
    }
    const cliId = host.getCliSessionId(meta.id);
    const diskHit = cliId ? diskById.get(`${profile.id}:${cliId}`) : undefined;
    const diskEntry = (own && diskHit?.find((e) => e.ws.id === own.id)) ?? diskHit?.[0];
    /* 孤儿活会话(归属与磁盘双无):全部视图收,单工作区视图滤掉。 */
    if (!own && !diskEntry && !allMode) continue;
    /* 无磁盘无 createdAt 的兜底时刻首见钉死:不随渲染漂移(跨小时会跳时带)。 */
    let firstSeen = LIVE_FIRST_SEEN.get(meta.id);
    if (firstSeen === undefined) {
      firstSeen = Date.now();
      LIVE_FIRST_SEEN.set(meta.id, firstSeen);
    }
    const ts = diskEntry?.disk.createdAt ?? meta.createdAt ?? firstSeen;
    rows.push({
      key: `live:${meta.id}`,
      profile,
      profileId: profile.id,
      cliSessionId: cliId,
      wsId: own?.id ?? diskEntry?.ws.id ?? "",
      wsName: own
        ? workspaceDisplayName(own)
        : diskEntry
          ? workspaceDisplayName(diskEntry.ws)
          : (meta.cwd.split("/").filter(Boolean).pop() ?? "—"),
      wsRoot: own?.root ?? diskEntry?.ws.root ?? meta.cwd,
      title: resolveTitle(
        profile.id,
        cliId,
        titles,
        getSessionBaseline(meta.id),
        diskEntry?.disk.title,
        cliId ?? meta.id,
      ),
      ts,
      activeTs: Date.now(),
      st: host.isTurnActive(meta.id) ? "running" : "idle",
      live: true,
      hostId: meta.id,
      unread: host.isUnread(meta.id) || undefined,
    });
  }
  /* 只写不清会随进程单调增长:活会话消失即剪(评审 P3)。 */
  for (const key of LIVE_FIRST_SEEN.keys()) {
    if (!liveIds.has(key)) LIVE_FIRST_SEEN.delete(key);
  }
  return rows;
}
