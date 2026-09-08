/**
 * 启动自动激活最近会话 —— 后台预开 PTY,兑现「点击秒开」。
 *
 * 语义(见 docs/superpowers/specs/2026-09-08-auto-activate-recent-sessions-design.md):
 * 启动后对各 工作区×CLI 分组扫 listSessions,取最近 days 天有活动的磁盘会话,
 * 全局按 modifiedAt 降序截到 max 条,低并发后台 openDiskSession(activate:false)。
 * 预开的进程不占 tab、不抢焦点(activeSessionChanged 不广播);用户点击时命中
 * SessionSpawnService.open() 的身份去重分支,直接聚焦既有进程。
 *
 * 约束:
 * - profile 必须同时声明 listSessions + resumeArgs;缺 resumeArgs 自动激活会退化成
 *   乱开全新会话,跳过。singleInstance(dsh 会话即 host)也跳过——自动拉起归它
 *   自己的 autoStart 链路。
 * - spawn 失败静默(console.warn),silent 抑制 sessionStartFailed 广播防 toast 风暴。
 * - 每个预激活都是一个真实 CLI 常驻进程,max 硬上限是内存闸门,不可省。
 */

import type { CliDiskSession, CliProfile } from "./cli";
import { host } from "./host";
import { getSettingsState } from "./settings";
import { getWorkspaces, workspacesReady, type Workspace } from "./workspace";

/** 一条待预激活的磁盘会话(定位四元组 + 排序键)。 */
export interface AutoActivateCandidate {
  profileId: string;
  cwd: string;
  workspaceId: string | undefined;
  cliSessionId: string;
  modifiedAt: number;
}

/**
 * 收集纯函数(测试面):窗口过滤 + 降序排序 + max 截断。
 * 每组 = 一个 工作区×profile 的磁盘扫描结果;缺 resumeArgs / singleInstance 的组不进池。
 */
export function pickAutoActivateCandidates(
  groups: ReadonlyArray<{
    profile: Pick<CliProfile, "id" | "resumeArgs" | "singleInstance">;
    workspace: Pick<Workspace, "id" | "root">;
    sessions: readonly CliDiskSession[];
  }>,
  now: number,
  cfg: { days: number; max: number },
): AutoActivateCandidate[] {
  if (cfg.days <= 0) return [];
  const floor = now - cfg.days * 86_400_000;
  const pool: AutoActivateCandidate[] = [];
  for (const g of groups) {
    if (!g.profile.resumeArgs || g.profile.singleInstance) continue;
    for (const s of g.sessions) {
      if (s.modifiedAt >= floor) {
        pool.push({
          profileId: g.profile.id,
          cwd: g.workspace.root,
          workspaceId: g.workspace.id,
          cliSessionId: s.id,
          modifiedAt: s.modifiedAt,
        });
      }
    }
  }
  pool.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return pool.slice(0, cfg.max);
}

/** 预激活并发闸:2 个一批错峰 spawn,不与首屏/彼此争抢。 */
const AUTO_ACTIVATE_CONCURRENCY = 2;

/** 单组扫描超时:dsh 等 host-RPC 型 listSessions 会等 host 就绪(数十秒),不得拖死整批。 */
const SCAN_TIMEOUT_MS = 8_000;

function scanWithTimeout(
  profile: CliProfile,
  ws: Workspace,
): Promise<{ profile: CliProfile; workspace: Workspace; sessions: CliDiskSession[] }> {
  const sessions = Promise.race([
    profile.listSessions!(ws.root),
    new Promise<CliDiskSession[]>((r) => setTimeout(() => r([]), SCAN_TIMEOUT_MS)),
  ]).catch(() => [] as CliDiskSession[]);
  return sessions.then((list) => ({ profile, workspace: ws, sessions: list }));
}

async function runAutoActivate(h: typeof host): Promise<void> {
  await workspacesReady;
  const cfg = getSettingsState().settings.autoActivateSessions;
  if (cfg.days <= 0) return;
  const profiles = h
    .getCliProfiles()
    .filter((p) => p.listSessions && p.resumeArgs && !p.singleInstance);
  const groups = (
    await Promise.all(getWorkspaces().flatMap((ws) => profiles.map((p) => scanWithTimeout(p, ws))))
  ).filter((g) => g.sessions.length > 0);
  const candidates = pickAutoActivateCandidates(groups, Date.now(), cfg);
  for (let i = 0; i < candidates.length; i += AUTO_ACTIVATE_CONCURRENCY) {
    await Promise.all(
      candidates.slice(i, i + AUTO_ACTIVATE_CONCURRENCY).map((c) =>
        h
          .openDiskSession(c.profileId, c.cwd, c.workspaceId, c.cliSessionId, {
            activate: false,
            silent: true,
          })
          .catch((e: unknown) =>
            console.warn(`autoActivate: 预激活失败 ${c.profileId}:${c.cliSessionId}`, e),
          ),
      ),
    );
  }
}

let booted = false;
/** 启动接线(main.tsx activateAll 后调用);幂等,StrictMode 双调用不重复。 */
export function bootAutoActivate(h: typeof host = host): void {
  if (booted) return;
  booted = true;
  void runAutoActivate(h).catch((e: unknown) =>
    console.warn("autoActivate: 启动扫描失败", e),
  );
}
