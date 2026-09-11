/**
 * 会话服务装配 —— 自 host.ts 拆出(文件规模铁则收紧至 300 行)。
 * 承担:ssh/shell/spawn 三个会话服务与其 host ctx 的接线。
 * 三服务共享同一张会话表回调集;spawn 另有身份探测/状态守望/spawn 编排专用回调,
 * 守望侧能力经 HostWatches(hostWatches.ts)到达,语义注释见各服务文件。
 */

import type { EventBus } from "./events";
import { SessionSpawnService } from "./sessionSpawn";
import { ShellSessionService } from "./shellSessions";
import { SshSessionService } from "./sshSessions";
import { readoptSessions } from "./sessionAdopt";
import type { HostWatches } from "./hostWatches";
import type { CliProfile } from "./cli";
import type { SessionMeta } from "./ipc";

/** 三张服务 ctx 的并集,由 Host 以惰性箭头注入(同各服务文件头纪律)。 */
export interface HostSessionServicesCtx {
  /** 从 Rust 注册表刷新活会话表。 */
  refreshSessions(): Promise<void>;
  getSessions(): SessionMeta[];
  setSessions(sessions: SessionMeta[]): void;
  findSession(sessionId: string): SessionMeta | undefined;
  getCliProfile(profileId: string): CliProfile | undefined;
  /** 活跃指针直写(装配内置新会话为 active;广播由 spawn 发,不走 setActiveSession)。 */
  setActiveSessionId(id: string | null): void;
  /** 活跃指针公开语义(去重聚焦已有会话:含已读标记/状态刷新/广播)。 */
  setActiveSession(id: string): void;
  removeSession(sessionId: string): Promise<void>;
  /** 登记输出/退出退订对(会话移除时成对退订)。 */
  trackUnlisten(sessionId: string, offs: Array<() => void>): void;
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}

export interface HostSessionServices {
  ssh: SshSessionService;
  shell: ShellSessionService;
  spawn: SessionSpawnService;
  /** webview 重载后活 PTY 重新接管(会话表合并 + 常驻订阅重建)。 */
  readopt: () => Promise<void>;
}

export function createSessionServices(
  ctx: HostSessionServicesCtx,
  watches: HostWatches,
  events: EventBus,
): HostSessionServices {
  /* ssh/shell/spawn 共享的会话表回调集(与原 host.ts 内联字面量逐项等价)。 */
  const base = {
    refreshSessions: () => ctx.refreshSessions(),
    findSession: (sessionId: string) => ctx.findSession(sessionId),
    appendOutput: (sessionId: string, text: string) =>
      watches.appendOutput(sessionId, text),
    removeSession: (sessionId: string) => ctx.removeSession(sessionId),
    trackUnlisten: (sessionId: string, offs: Array<() => void>) =>
      ctx.trackUnlisten(sessionId, offs),
    getSessions: () => ctx.getSessions(),
    notify: () => ctx.notify(),
  };
  return {
    ssh: new SshSessionService(base, events),
    shell: new ShellSessionService(base, events),
    spawn: new SessionSpawnService(
      {
        getCliProfile: (id) => ctx.getCliProfile(id),
        getSessions: base.getSessions,
        setSessions: (sessions) => ctx.setSessions(sessions),
        findSession: base.findSession,
        setActiveSessionId: (id) => ctx.setActiveSessionId(id),
        setActiveSession: (id) => ctx.setActiveSession(id),
        bindIdentity: (sessionId, cliSessionId) =>
          watches.bindIdentity(sessionId, cliSessionId),
        getCliSessionId: (sessionId) => watches.getCliSessionId(sessionId),
        identityTrack: (sessionId, profileId, cwd, before, spawnedAt) =>
          watches.identityTrack(sessionId, profileId, cwd, before, spawnedAt),
        statusEnsurePolling: () => watches.statusEnsurePolling(),
        statusRefresh: (sessionId) => watches.statusRefresh(sessionId),
        statusSeed: (sessionId) => watches.statusSeed(sessionId),
        trackUnlisten: base.trackUnlisten,
        outputTail: (sessionId, maxChars) =>
          watches.outputTail(sessionId, maxChars),
        appendOutput: base.appendOutput,
        removeSession: base.removeSession,
        notify: base.notify,
      },
      events,
    ),
    /* webview 重载后活 PTY 重新接管(语义见 kernel/sessionAdopt.ts readoptSessions)。 */
    readopt: () =>
      readoptSessions(
        { ...base, setSessions: (sessions) => ctx.setSessions(sessions) },
        events,
      ),
  };
}
