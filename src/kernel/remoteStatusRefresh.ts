/**
 * 远程引擎会话状态观测 —— 自 hostWatches 拆出(文件规模铁则)。
 * 来源工作区(workspaceOrigins.remoteExec,如 WSL over SSH 通道)+ 引擎远程
 * 适配(CliProfile.remoteSessions)齐备时,模型/思考实况走远端磁盘通道读取;
 * 返回 false = 非远程形态,调用方落回本机会话文件观测。
 */

import type { CliProfile, CliSessionStatus } from "./cli";
import type { SessionMeta } from "./ipc";
import { getWorkspaces } from "./workspace";
import { findWorkspaceOrigin } from "./workspaceOrigins";

/** Host 侧能力注入(与 HostWatchesCtx 同款箭头函数惰性绑定惯例)。 */
export interface RemoteStatusDeps {
  findSession(sessionId: string): SessionMeta | undefined;
  getCliProfile(profileId: string): CliProfile | undefined;
  getCliSessionId(sessionId: string): string | undefined;
  bindIdentity(sessionId: string, cliSessionId: string): boolean;
  applyObserved(sessionId: string, status: CliSessionStatus): void;
  notify(): void;
}

/** 远程身份绑定 + 状态读取;true = 本会话已按远程形态处理(含"尚无远端落盘")。 */
export async function refreshRemoteStatus(
  deps: RemoteStatusDeps,
  sessionId: string,
): Promise<boolean> {
  const session = deps.findSession(sessionId);
  const profile = session ? deps.getCliProfile(session.profileId) : undefined;
  const remote = profile?.remoteSessions;
  if (!session || !remote) return false;
  const ws = getWorkspaces().find((w) => w.id === session.workspaceId);
  const exec = (ws ? findWorkspaceOrigin(ws)?.remoteExec?.(ws) : null) ?? null;
  if (!ws || !exec) return false;
  let cliId = deps.getCliSessionId(session.id);
  if (!cliId) {
    /* 远程会话本机身份探测天然绑不上,这里自带远程身份绑定:
       remote 列表中 createdAt ≥ 会话创建-5s 的最早条目即本会话。 */
    const rows = await remote.list(exec, session.cwd).catch(() => []);
    const cand = rows
      .filter((r) => (r.createdAt ?? 0) >= (session.createdAt ?? 0) - 5_000)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    if (!cand) return true; // 尚无远端落盘(懒 flush):继续巡航
    if (!deps.bindIdentity(session.id, cand.id)) return true;
    cliId = cand.id;
    deps.notify();
  }
  const observed = (await remote.readStatus?.(exec, session.cwd, cliId)) ?? null;
  if (observed) deps.applyObserved(session.id, observed);
  return true;
}
