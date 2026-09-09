/**
 * 本地 CLI 会话 spawn 与装配 —— 从 host.ts 拆出(单文件 ≤300 行铁则)。
 *
 * 职责:createSession / openDiskSession 两条 spawn 路径 + adoptSpawned 统一装配
 * (身份探测登记、常驻订阅输出/退出、置 active)。秒退守望也归此件:进程在
 * 启动窗口内退出 = 启动失败,摘幕布尾部报错广播 sessionStartFailed ——
 * pty://exit 会秒删 tab、removeSession 即清输出缓冲,报错在任何界面都
 * 来不及呈现(静默闪退;SSH 侧同题已在 Rust fail_session 缓解,本地无)。
 */

import { KernelTopics, type EventBus, type SessionStartFailedEvent } from "./events";
import { ipc, type SessionMeta, type SpawnSpec, type SpawnedSession } from "./ipc";
import { adoptPtySession, ADOPT_RACE_REASON } from "./sessionAdopt";
import { prefetchDiskTail } from "./diskReplay";
import type { CliProfile } from "./cli";

/** spawn 后多久内退出视为「启动失败」。node 系 CLI 冷启动数秒,窗口取宽些。 */
const START_FAIL_WINDOW_MS = 20_000;
/** 摘报错的幕布尾部字符数(取宽留给压缩,展示侧再截)。 */
const TAIL_SOURCE_CHARS = 2_000;

/**
 * 幕布尾部 → 可读报错摘要:剥 ANSI(TUI 把报错裹进样式序列)、\r 重绘折叠、
 * 丢 JS 栈帧行(噪音),留最后几行非空文本。空输出给固定文案。
 */
export function crashTail(raw: string): string {
  const text = raw
    .slice(-TAIL_SOURCE_CHARS)
    .replace(
      /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_].*?\x1b\\|\x1b[@-_]/g,
      "",
    )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*at\s/.test(line))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text.length > 0 ? text.slice(-600) : "进程退出且无任何输出";
}

/** host 侧最小依赖面(箭头函数惰性绑定,避免整 host 的构造顺序耦合)。 */
interface SessionSpawnHost {
  getCliProfile(profileId: string): CliProfile | undefined;
  /** 活会话表(读:身份去重/存活复查;写:spawn 后以 Rust 注册表为准刷新)。 */
  getSessions(): SessionMeta[];
  setSessions(sessions: SessionMeta[]): void;
  /** 活会话查存(装配竞态守卫,见 kernel/sessionAdopt.ts)。 */
  findSession(sessionId: string): SessionMeta | undefined;
  /** 活跃指针直写(装配内置新会话为 active;广播由本件发,不走 setActiveSession)。 */
  setActiveSessionId(id: string): void;
  /** 活跃指针公开语义(去重聚焦已有会话:含已读标记/状态刷新/广播)。 */
  setActiveSession(id: string): void;
  /** CLI 磁盘身份绑定唯一写入口(host.bindIdentity,抢绑终审在彼处)。 */
  bindIdentity(sessionId: string, cliSessionId: string): boolean;
  getCliSessionId(sessionId: string): string | undefined;
  /** 身份探测登记(createSession 专用;openDiskSession 已知身份不探测)。 */
  identityTrack(
    sessionId: string,
    profileId: string,
    cwd: string,
    before: Map<string, number> | null,
    spawnedAt: number,
  ): void;
  statusEnsurePolling(): void;
  statusRefresh(sessionId: string): void;
  statusSeed(sessionId: string): void;
  /** 登记输出/退出退订对(会话移除时成对退订)。 */
  trackUnlisten(sessionId: string, offs: Array<() => void>): void;
  /** 幕布输出尾部(秒退守望摘报错用;removeSession 即清,须在退出回调同步取)。 */
  outputTail(sessionId: string, maxChars: number): string;
  /** PTY 输出落缓冲 + 实时 topic 广播(host.appendOutput 主链路)。 */
  appendOutput(sessionId: string, text: string): void;
  /** 会话移除(exit 回调清场;host.removeSession 主链路)。 */
  removeSession(sessionId: string): Promise<void>;
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}

export class SessionSpawnService {
  /** openDiskSession 在途单例闸:key = profileId:cliSessionId,双击去重。 */
  private openingDiskSessions = new Map<string, Promise<SessionMeta>>();
  /** singleInstance profile 的 create 在途闸:key = profileId,双击不去重会开出两个 host。 */
  private openingSingleInstances = new Map<string, Promise<SessionMeta>>();

  constructor(
    private readonly h: SessionSpawnHost,
    private readonly events: EventBus,
  ) {}

  /** 新建 CLI 会话:由 profile 拼 SpawnSpec(spawn 前快照磁盘会话供身份探测)。 */
  async create(profileId: string, cwd: string, workspaceId?: string): Promise<SessionMeta> {
    const profile = this.h.getCliProfile(profileId);
    if (!profile) throw new Error(`未知 CLI profile: ${profileId}`);
    return this.guarded(profileId, () => this.spawnNew(profileId, profile, cwd, workspaceId));
  }

  /**
   * 按任意 spec spawn 并完整装配(通用原语,shell 之外的插件自定 PTY 会话用,
   * 例 dsh host 面板的自定义路径/参数启动)。与 create 的差异:spec 由调用方
   * 给,不走 profile.command/args;身份探测/秒退守望按 profile 声明自然退化。
   */
  async raw(
    profileId: string,
    spec: SpawnSpec,
    workspaceId?: string,
    opts?: { activate?: boolean },
  ): Promise<SessionMeta> {
    return this.guarded(profileId, async () => {
      const spawned = await this.spawn(profileId, spec, workspaceId);
      return this.adoptSpawned(spawned.id, profileId, undefined, opts?.activate);
    });
  }

  /**
   * 单实例闸(菜单 create 与插件 raw 共用):已有活会话 = 聚焦既有,不再
   * spawn;并发请求由在途闸收口 —— 否则自动启动与菜单点击两条 spawn 路在
   * 探测窗内并发,第二个 `dsh web` 必然 EADDRINUSE。
   */
  private async guarded(
    profileId: string,
    task: () => Promise<SessionMeta>,
  ): Promise<SessionMeta> {
    if (!this.h.getCliProfile(profileId)?.singleInstance) return task();
    const existing = this.h.getSessions().find((s) => s.profileId === profileId);
    if (existing) {
      this.h.setActiveSession(existing.id);
      return existing;
    }
    const opening = this.openingSingleInstances.get(profileId);
    if (opening) return opening;
    const running = (async () => {
      try {
        return await task();
      } finally {
        this.openingSingleInstances.delete(profileId);
      }
    })();
    this.openingSingleInstances.set(profileId, running);
    return running;
  }

  private async spawnNew(
    profileId: string,
    profile: CliProfile,
    cwd: string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    let spec: SpawnSpec = {
      command: profile.command,
      args: profile.args,
      cwd,
      env: profile.env,
    };
    if (profile.spawnTransform) spec = await profile.spawnTransform(spec);
    const spawnedAt = Date.now();
    /* 快照既有磁盘会话(id → 快照时 mtime):spawn 后 CLI 新落盘/复活的文件据此绑到活会话。
       快照失败 → null → 退化到 spawn 水位线判定(只认 spawn 后的落盘/增长),
       pre-spawn 旧文件永远不得抢绑:身份绑定 fail-open(张冠李戴)比 fail-closed(状态 "—")恶劣一个数量级。 */
    const before = profile.listSessions
      ? await profile.listSessions(cwd).then(
          (list) => new Map(list.map((s) => [s.id, s.modifiedAt] as const)),
          () => null,
        )
      : null;
    const spawned = await this.spawn(profileId, spec, workspaceId);
    if (profile.listSessions) {
      this.h.identityTrack(spawned.id, profileId, cwd, before, spawnedAt);
    }
    return this.adoptSpawned(spawned.id, profileId, undefined);
  }

  /**
   * 打开 CLI 磁盘历史会话:按 profile.resumeArgs 带 cliSessionId 重连。
   * 数据源是各 CLI 插件的 listSessions 扫描结果,tmd-cli 不持有任何映射。
   */
  async open(
    profileId: string,
    cwd: string,
    workspaceId: string | undefined,
    cliSessionId: string,
  ): Promise<SessionMeta> {
    /* 磁盘先行回放:预取先于一切派发(happens-before,此刻指针仍指上一代,见 diskReplay.ts) */
    prefetchDiskTail(profileId, cwd, cliSessionId);
    const profile = this.h.getCliProfile(profileId);
    if (!profile) throw new Error(`未知 CLI profile: ${profileId}`);
    // 身份去重:该磁盘会话已有活 PTY → 聚焦既有会话,同一会话绝不出两条
    const existing = this.h
      .getSessions()
      .find(
        (s) => s.profileId === profileId && this.h.getCliSessionId(s.id) === cliSessionId,
      );
    if (existing) {
      this.h.setActiveSession(existing.id);
      return existing;
    }
    /* 在途单例闸(与 PluginLifecycle.activation 同构):快速双击历史行时,
       两个并发 openDiskSession 都能通过上面的活表检查 —— 若不收口,
       同一 CLI 磁盘会话会开出两个 PTY,cliSessionIds 后写覆盖先写 */
    const key = `${profileId}:${cliSessionId}`;
    const opening = this.openingDiskSessions.get(key);
    if (opening) {
      /* 双击复用在途 Promise,完成后补聚焦(否则第二次点击无响应) */
      void opening.then((m) => this.h.setActiveSession(m.id)).catch(() => undefined);
      return opening;
    }
    const args = profile.resumeArgs?.(cliSessionId) ?? profile.args;
    let spec: SpawnSpec = {
      command: profile.command,
      args,
      cwd,
      env: profile.env,
    };
    /* resume 同过 transform(dsh:--resume 标记 → 适配器 --session-id;契约与 spawnNew 一致) */
    if (profile.spawnTransform) spec = await profile.spawnTransform(spec);
    const task = (async () => {
      try {
        const spawned = await this.spawn(profileId, spec, workspaceId);
        return await this.adoptSpawned(spawned.id, profileId, cliSessionId);
      } finally {
        this.openingDiskSessions.delete(key);
      }
    })();
    this.openingDiskSessions.set(key, task);
    return task;
  }

  /** spawn 统一收口:被拒(命令不存在/IPC 错)时幕布不存在,广播原因再抛。 */
  private async spawn(
    profileId: string,
    spec: SpawnSpec,
    workspaceId?: string,
  ): Promise<SpawnedSession> {
    return await ipc.sessionSpawn(profileId, spec, workspaceId).catch((e: unknown) => {
      const event: SessionStartFailedEvent = {
        sessionId: null,
        profileId,
        reason: e instanceof Error ? e.message : String(e),
      };
      this.events.emit(KernelTopics.sessionStartFailed, event);
      throw e;
    });
  }

  /**
   * spawn 后的统一装配:绑定磁盘身份、刷新活表、置为 active、常驻订阅输出与退出
   * (订阅/竞态守卫/广播收口在 kernel/sessionAdopt.ts;守卫命中已广播,抛出上抛)。
   */
  private async adoptSpawned(
    sessionId: string,
    profileId: string,
    cliSessionId?: string,
    activate = true,
  ): Promise<SessionMeta> {
    /* 显式恢复路径的绑定也走唯一写入口:入口去重的兜底闸 —— 同一磁盘会话
       已有活 PTY 时新 PTY 照常运行,但身份不绑(账本/UI 按 tmd id 隔离,不与既有会话并账)。*/
    if (cliSessionId) this.h.bindIdentity(sessionId, cliSessionId);
    this.h.setSessions(await ipc.sessionList());
    if (activate) this.h.setActiveSessionId(sessionId);
    /* 常驻订阅从会话诞生起持续缓冲输出(与幕布是否挂载无关);
       秒退守望经 onExit 进退出回调 —— 缓冲随 removeSession 即清,摘尾须在清理前同步执行 */
    const adoptedAt = Date.now();
    const meta = await adoptPtySession(this.h, this.events, sessionId, {
      profileId,
      activate,
      onExit: (id) => this.emitIfStartFailed(id, profileId, adoptedAt),
    });
    if (!meta) throw new Error(ADOPT_RACE_REASON);
    this.h.statusEnsurePolling();
    void this.h.statusRefresh(sessionId);
    /* 全新会话创建即赋值:磁盘文件要等首条消息才落盘,先种 CLI 默认配置 */
    if (!cliSessionId) void this.h.statusSeed(sessionId);
    return meta;
  }

  /** 启动窗口内退出 = 启动失败:摘幕布尾部广播 sessionStartFailed(Toast 呈现)。 */
  private emitIfStartFailed(sessionId: string, profileId: string, adoptedAt: number): void {
    if (Date.now() - adoptedAt > START_FAIL_WINDOW_MS) return;
    if (!this.h.getSessions().some((s) => s.id === sessionId)) return;
    this.events.emit(KernelTopics.sessionStartFailed, {
      sessionId,
      profileId,
      reason: crashTail(this.h.outputTail(sessionId, TAIL_SOURCE_CHARS)),
    });
  }
}
