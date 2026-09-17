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
import { stripAnsi } from "./askDetect";
import type { CliProfile } from "./cli";
import { ipc, type SessionMeta } from "./ipc";

/** 三张服务 ctx 的并集,由 Host 以惰性箭头注入(同各服务文件头纪律)。 */
interface HostSessionServicesCtx {
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

interface HostSessionServices {
  ssh: SshSessionService;
  shell: ShellSessionService;
  spawn: SessionSpawnService;
  /** webview 重载后活 PTY 重新接管(会话表合并 + 常驻订阅重建)。 */
  readopt: () => Promise<void>;
}
/** 接管磁盘尾取量:镜像补底与回显重锚单取分用(免逐会话重复 IPC;256KB 覆盖最后一帧整帧重绘 + 近期对话回显,pi-tui 单帧可达 9KB)。 */
const READOPT_TAIL_BYTES = 256 * 1024;
/** busy 现势证据采样窗(语义见 readopt 内联注释)。 */
const READOPT_BUSY_TAIL_CHARS = 16 * 1024;

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
    seedOutputBuffer: (sessionId: string, text: string) =>
      watches.seedOutputBuffer(sessionId, text),
    removeSession: (sessionId: string) => ctx.removeSession(sessionId),
    trackUnlisten: (sessionId: string, offs: Array<() => void>) =>
      ctx.trackUnlisten(sessionId, offs),
    getSessions: () => ctx.getSessions(),
    setActiveSession: (id: string) => ctx.setActiveSession(id),
    notify: () => ctx.notify(),
  };
  return {
    ssh: new SshSessionService(
      {
        ...base,
        getCliSessionId: (sessionId) => watches.getCliSessionId(sessionId),
        bindIdentity: (sessionId, cliSessionId) =>
          watches.bindIdentity(sessionId, cliSessionId),
      },
      events,
    ),
    shell: new ShellSessionService(base, events),
    spawn: new SessionSpawnService(
      {
        getCliProfile: (id) => ctx.getCliProfile(id),
        getSessions: base.getSessions,
        setSessions: (sessions) => ctx.setSessions(sessions),
        findSession: base.findSession,
        setActiveSessionId: (id: string) => ctx.setActiveSessionId(id),
        setActiveSession: (id: string) => ctx.setActiveSession(id),
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
        /* 预灌输出缓冲(接管转正;不进守望主链,语义见 hostWatches.seedOutputBuffer) */
        seedOutputBuffer: base.seedOutputBuffer,
        removeSession: base.removeSession,
        notify: base.notify,
      },
      events,
    ),
    /* webview 重载后活 PTY 重新接管(语义见 kernel/sessionAdopt.ts readoptSessions)。
       接管后磁盘尾单取分用两路:屏幕镜像补挂起面板(补盲语义见
       askScreenMirror.ts);活动守望按「回显历史 + 在途现势」双证据重锚(重载前
       在途轮次不丢因果,见 ActivityWatch.readoptAnchor 与 HostWatches.readoptAnchor)。 */
    readopt: async () => {
      await readoptSessions(
        { ...base, setSessions: (sessions) => ctx.setSessions(sessions) },
        events,
      );
      /* 账本死项剪除(必须在此刻:活表已按 Rust 注册表定稿;冷启动清陈账,重载全保留) */
      watches.pruneIdentities();
      const jobs: Promise<void>[] = [];
      for (const s of ctx.getSessions()) {
        if ((s.kind ?? "cli") !== "cli") continue;
        jobs.push(
          (async () => {
            const end = await ipc.sessionLogSize(s.id);
            if (!end) return; /* 无日志(含尚未落盘的新会话)= 无现势可补、无回显证据 */
            const page = await ipc.sessionHistoryPage(s.id, end, READOPT_TAIL_BYTES);
            watches.screenMirror.backfill(s.id, page.text);
            if (!page.text) return;
            /* busy 现势证据:尾 16KB 剥壳行级命中 busyMarks = CLI 自证在途 —— 在工帧流 2.5-10Hz
               必中(2026-09-16 实采 3 会话尾 16KB 各 13-15 帧 ⎋),兜底回显滚出 256KB 窗的长轮次;
               完工后空闲页脚自绘约 1-4 分钟推出窗,误锚 2-3s 自结算零残留。 */
            const recent = stripAnsi(page.text.slice(-READOPT_BUSY_TAIL_CHARS)).split(/\r\n|\r|\n/);
            const profile = ctx.getCliProfile(s.profileId);
            const busy = !!profile?.busyMarks?.some((re) => recent.some((l) => re.test(l)));
            watches.readoptAnchor(s.id, page.text, profile?.echoMarks, busy);
          })().catch(() => undefined), /* 补底/重锚是增强:失败保持未恢复(同 I1 零语义),不拖垮接管 */
        );
      }
      await Promise.all(jobs);
    },
  };
}
