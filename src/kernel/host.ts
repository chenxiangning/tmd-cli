/**
 * 宿主 —— 插件注册表 + 挂载点注册表 + 会话服务的装配点。
 *
 * 内核不 import 任何插件；插件清单在 src/plugins/index.ts，
 * main.tsx 启动时一次性注册激活。
 */

import { useSyncExternalStore } from "react";
import { EventBus, KernelTopics } from "./events";
import { getSettingsState } from "./settings";
import { pickFreshIdentity, listFreshCandidates, pickContentIdentity } from "./diskIdentity";
import { PluginLifecycle } from "./pluginLifecycle";
import { ActivityWatch } from "./activityWatch";
import { AskWatch } from "./askWatch";
import { OutputBufferStore } from "./outputBuffers";
import { SessionStatusWatch } from "./sessionStatus";

import { ipc, onPtyExit, onPtyOutput, type SessionMeta, type SpawnSpec } from "./ipc";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";
import { registerSettingsSection, type SettingsSectionContribution } from "./settingsRegistry";

class Host implements PluginContext {
  readonly events = new EventBus();

  private cliProfiles = new Map<string, CliProfile>();
  private mounts = new Map<MountPoint, MountContribution[]>();
  private sessions: SessionMeta[] = [];
  private activeSessionId: string | null = null;
  /**
   * 待绑定磁盘身份的会话:sessionId → 快照基线 + spawn 水位线。
   * 快相位(500ms×30)扫不尽就转入状态巡航的慢相位(2s),直到绑上或会话死 —
   * 实证:omp 全新会话要等首条消息才落盘,15s 上限必然失明。
   */
  private pendingIdentities = new Map<
    string,
    { profileId: string; cwd: string; before: ReadonlyMap<string, number> | null; spawnedAt: number }
  >();
  /** 活会话对应的 CLI 当前模型/思考强度与来源分级(实现见 kernel/sessionStatus.ts)。 */
  private readonly statusWatch = new SessionStatusWatch({
    getActiveSessionId: () => this.activeSessionId,
    findSession: (sessionId) => this.sessions.find((s) => s.id === sessionId),
    hasSession: (sessionId) => this.sessions.some((s) => s.id === sessionId),
    getCliProfile: (profileId) => this.cliProfiles.get(profileId),
    getCliSessionId: (sessionId) => this.cliSessionIds.get(sessionId),
    isPendingIdentity: (sessionId) => this.pendingIdentities.has(sessionId),
    tryBindIdentity: (sessionId) => this.tryBindIdentity(sessionId),
    notify: () => this.notify(),
  });
  private listeners = new Set<() => void>();
  /**
   * 每会话 PTY 输出环形缓冲：会话切换后 xterm 重挂载靠它回放，这是"切回不黑屏"的核心。
   * 存储细节(分块/迟滞截断/字节数增量)见 kernel/outputBuffers.ts。
   */
  private readonly outputBuffers = new OutputBufferStore();
  private readonly askWatch = new AskWatch(() => this.notify()); /* Ask 等待确认状态仓(见 kernel/askWatch.ts,onHealed = 静默自愈摘签后重渲染) */
  /**
   * 活会话 → CLI 磁盘身份绑定(omp/pi 的 jsonl uuid、codex 的 rollout id)。
   * 纯前端内存,随 PTY 消亡 —— 这是活会话的身份属性,不是持久化映射。
   * 用途:UI 按身份去重(同一会话在活区/磁盘区只出现一次)。
   */
  private cliSessionIds = new Map<string, string>();

  /** 并行 spawn 仲裁窗口:年轻会话等待更老未绑定会话先认领的最长时长。 */
  private static readonly BIND_DEFER_MS = 10_000;

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  getCliSessionId(sessionId: string): string | undefined {
    return this.cliSessionIds.get(sessionId);
  }
  /**
   * PTY 事件退订表:spawn 时登记输出/退出两个全局监听,会话移除时成对退订。
   * 此前 void 掉 listen 的 UnlistenFn,每次 spawn 泄漏 2 个监听器。
   */
  private ptyUnlistens = new Map<string, Array<() => void>>();
  /** openDiskSession 在途单例闸:key = profileId:cliSessionId,双击去重。 */
  private openingDiskSessions = new Map<string, Promise<SessionMeta>>();
  /** 窗口聚焦态(main.tsx 挂 focus/blur 监听馈入):失焦时激活会话完成也视为未查看。 */
  private windowFocused = true;
  private readonly activity = new ActivityWatch({
    /* 后台提醒开启时,窗口失焦的激活会话不算"正在查看"(完成照标蓝/响结束音);
       Node 测试环境 windowFocused 恒 true,退化为纯 activeSessionId 语义 */
    isViewing: (id) =>
      id === this.activeSessionId &&
      (!getSettingsState().settings.backgroundNotify || this.windowFocused),
    exists: (id) => this.sessions.some((s) => s.id === id),
    onChange: () => this.notify(),
    onTurnSettled: (id, unviewed, settledAt) => {
      this.events.emit(KernelTopics.turnSettled, { sessionId: id, unviewed, settledAt });
    },
});

// ---- PluginContext 实现 -------------------------------------------------

  registerCliProfile(profile: CliProfile): void {
    if (this.cliProfiles.has(profile.id)) {
      throw new Error(`CLI profile 重复注册: ${profile.id}`);
    }
    this.cliProfiles.set(profile.id, profile);
    this.notify();
  }

  contribute(point: MountPoint, contribution: MountContribution): void {
    const list = this.mounts.get(point) ?? [];
    list.push(contribution);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.mounts.set(point, list);
    this.notify();
  }
  /** 委托给设置注册表(kernel/settingsRegistry);注册表自驱动通知,无需 host.notify。 */
  registerSettingsSection(section: SettingsSectionContribution): void {
    registerSettingsSection(section);
  }

  // ---- 插件生命周期(委托 kernel/pluginLifecycle;文件规模铁则拆分) -------------

  private readonly lifecycle = new PluginLifecycle();

  activateAll(plugins: Plugin[]): Promise<void> {
    return this.lifecycle.activateAll(plugins, this);
  }

  // ---- 查询（外壳/插件消费） ----------------------------------------------

  getCliProfiles(): CliProfile[] {
    return [...this.cliProfiles.values()];
  }

  getCliProfile(id: string): CliProfile | undefined {
    return this.cliProfiles.get(id);
  }

  getMount(point: MountPoint): MountContribution[] {
    return this.mounts.get(point) ?? [];
  }

  /** 插件市场数据源(委托 lifecycle)。 */
  listPluginStates(): { plugin: Plugin; enabled: boolean }[] {
    return this.lifecycle.listPluginStates();
  }
  /** 插件是否已激活(委托 lifecycle):特性门控用(如 SessionList 消费预算与否)。 */
  isPluginActive = (id: string): boolean => this.lifecycle.isPluginActive(id);

  getSessions(): SessionMeta[] {
    return this.sessions;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getSessionStatus(sessionId: string): CliSessionStatus | undefined {
    return this.statusWatch.get(sessionId);
  }

  /** 状态值来源:"seeded" = CLI 默认配置种子,"observed" = 会话文件真实观测。 */
  getSessionStatusSource(sessionId: string): "seeded" | "observed" | undefined {
    return this.statusWatch.source(sessionId);
  }

  // ---- 会话服务（kernel 固有职责：PTY 生命周期） ---------------------------

  async createSession(
    profileId: string,
    cwd: string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    const profile = this.cliProfiles.get(profileId);
    if (!profile) throw new Error(`未知 CLI profile: ${profileId}`);
    const spec: SpawnSpec = {
      command: profile.command,
      args: profile.args,
      cwd,
      env: profile.env,
    };
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
    const spawned = await ipc.sessionSpawn(profileId, spec, workspaceId);
    if (profile.listSessions) {
      this.pendingIdentities.set(spawned.id, { profileId, cwd, before, spawnedAt });
      void this.detectDiskIdentity(spawned.id);
    }
    return this.adoptSpawned(spawned.id);
  }

  /**
   * 打开 CLI 磁盘历史会话:按 profile.resumeArgs 带 cliSessionId 重连。
   * 数据源是各 CLI 插件的 listSessions 扫描结果,tmd-cli 不持有任何映射。
   */
  async openDiskSession(
    profileId: string,
    cwd: string,
    workspaceId: string | undefined,
    cliSessionId: string,
  ): Promise<SessionMeta> {
    const profile = this.cliProfiles.get(profileId);
    if (!profile) throw new Error(`未知 CLI profile: ${profileId}`);
    // 身份去重:该磁盘会话已有活 PTY → 聚焦既有会话,同一会话绝不出两条
    const existing = this.sessions.find(
      (s) =>
        s.profileId === profileId &&
        this.cliSessionIds.get(s.id) === cliSessionId,
    );
    if (existing) {
      this.setActiveSession(existing.id);
      return existing;
    }
    /* 在途单例闸(与 PluginLifecycle.activation 同构):快速双击历史行时,
       两个并发 openDiskSession 都能通过上面的活表检查 —— 若不收口,
       同一 CLI 磁盘会话会开出两个 PTY,cliSessionIds 后写覆盖先写 */
    const key = `${profileId}:${cliSessionId}`;
    const opening = this.openingDiskSessions.get(key);
    if (opening) return opening;
    const args = profile.resumeArgs?.(cliSessionId) ?? profile.args;
    const spec: SpawnSpec = {
      command: profile.command,
      args,
      cwd,
      env: profile.env,
    };
    const task = (async () => {
      try {
        const spawned = await ipc.sessionSpawn(profileId, spec, workspaceId);
        return await this.adoptSpawned(spawned.id, cliSessionId);
      } finally {
        this.openingDiskSessions.delete(key);
      }
    })();
    this.openingDiskSessions.set(key, task);
    return task;
  }

  /** spawn 后的统一装配:绑定磁盘身份、刷新活表、置为 active、常驻订阅输出与退出。 */
  private async adoptSpawned(
    sessionId: string,
    cliSessionId?: string,
  ): Promise<SessionMeta> {
    if (cliSessionId) this.cliSessionIds.set(sessionId, cliSessionId);
    this.sessions = await ipc.sessionList();
    this.activeSessionId = sessionId;
    // 常驻订阅：从会话诞生起就持续缓冲输出，与幕布是否挂载无关。
    const offOutput = await onPtyOutput(sessionId, (text) => {
      /* 存活守卫:退订前在途的迟到输出不得复活已删会话的缓冲/呼吸灯状态 */
      if (!this.sessions.some((s) => s.id === sessionId)) return;
      this.appendOutput(sessionId, text);
    });
    const offExit = await onPtyExit(sessionId, () => {
      void this.removeSession(sessionId);
      this.events.emit(KernelTopics.sessionExited, sessionId);
    });
    /* removeSession 插进两次订阅 await 之间 → 退订表查不到会漏退订:复查存活,已删则成对退订 */
    if (!this.sessions.some((s) => s.id === sessionId)) {
      [offOutput, offExit].forEach((off) => off());
      return this.sessions.find((s) => s.id === sessionId)!;
    }
    this.ptyUnlistens.set(sessionId, [offOutput, offExit]);
    this.events.emit(KernelTopics.sessionsChanged, this.sessions);
    this.events.emit(KernelTopics.activeSessionChanged, sessionId);
    this.notify();
    this.statusWatch.ensurePolling();
    void this.statusWatch.refresh(sessionId);
    /* 全新会话创建即赋值:磁盘文件要等首条消息才落盘,先种 CLI 默认配置 */
    if (!cliSessionId) void this.statusWatch.seed(sessionId);
    return this.sessions.find((s) => s.id === sessionId)!;
  }

  /**
   * 单次身份扫描:快相位(spawn 后 500ms×30)与慢相位(状态巡航 2s)共用。
   * 绑定成功即终 —— pendingIdentities 删除,两个相位自然停止。
   *
   * 主路径内容证据(pickContentIdentity):文件自证 id/cwd/createdAt + 兄弟仲裁,
   * 懒落盘 + 并行 spawn 不串线(实证:mtime 仲裁曾把同 cwd 两会话绑定互换)。
   * 兜底并行 spawn 仲裁(插件未声明自证时;claimed 只在绑定成功时记账):
   * - 新文件(基线外):spawn 窗口配对 —— 文件属于其落盘 mtime 之前最近 spawn 的
   *   未绑定会话。归属是我 → 立即绑;归属别人 → 本轮让位。
   * - 复活/无基线(归属不可判):BIND_DEFER_MS 窗口内老会话优先,窗口外放行。
   */
  private async tryBindIdentity(sessionId: string): Promise<void> {
    const pending = this.pendingIdentities.get(sessionId);
    if (!pending || this.cliSessionIds.has(sessionId)) return;
    const profile = this.cliProfiles.get(pending.profileId);
    if (!profile?.listSessions) return;
    const list = await profile.listSessions(pending.cwd).catch(() => []);
    /* await 期间会话可能已被移除:死会话绑上 CLI 身份会永久占位,
       令同 cwd 后续新会话再也绑不上该磁盘身份 */
    if (!this.sessions.some((s) => s.id === sessionId)) return;
    const claimed = new Set(this.cliSessionIds.values());
    /* unmatched = 文件读出了身份但不属于我(cwd 不符/归属兄弟)→ 强拒绝,等下一个文件;
       unreadable = 读不出身份或证据不足以唯一仲裁 → 才允许退回水位线仲裁。 */
    if (profile.readSessionFileIdentity) {
      const siblingSpawns = [...this.pendingIdentities]
        .filter(([id, p]) => id !== sessionId && p.profileId === pending.profileId && p.cwd === pending.cwd)
        .map(([, p]) => p.spawnedAt);
      const matched = await pickContentIdentity(
        listFreshCandidates(list, pending.before, pending.spawnedAt, claimed),
        pending.cwd,
        pending.spawnedAt,
        (path) => profile.readSessionFileIdentity!(path),
        siblingSpawns,
      );
      if (matched.kind === "matched") {
        this.cliSessionIds.set(sessionId, matched.id);
        this.pendingIdentities.delete(sessionId);
        void this.statusWatch.refresh(sessionId);
        this.notify();
        return;
      }
      if (matched.kind === "unmatched") return;
    }
    const fresh = pickFreshIdentity(list, pending.before, pending.spawnedAt, claimed);
    if (!fresh) return;

    const entry = list.find((s) => s.id === fresh);
    let ownerIsMe = false;
    if (entry && pending.before && !pending.before.has(fresh)) {
      let ownerId: string | null = null;
      let ownerSpawn = Number.NEGATIVE_INFINITY;
      for (const [id, p] of this.pendingIdentities) {
        if (p.profileId !== pending.profileId || p.cwd !== pending.cwd) continue;
        if (p.spawnedAt <= entry.modifiedAt && p.spawnedAt >= ownerSpawn) {
          ownerSpawn = p.spawnedAt;
          ownerId = id;
        }
      }
      if (ownerId !== null && ownerId !== sessionId) return; // 属于别的 spawn,让位
      ownerIsMe = ownerId === sessionId;
    }
    if (!ownerIsMe) {
      /* 归属不可判:老会话优先(窗口内) */
      for (const [id, p] of this.pendingIdentities) {
        if (id === sessionId || p.profileId !== pending.profileId || p.cwd !== pending.cwd) {
          continue;
        }
        if (p.spawnedAt < pending.spawnedAt && Date.now() - p.spawnedAt < Host.BIND_DEFER_MS) {
          return;
        }
      }
    }

    this.cliSessionIds.set(sessionId, fresh);
    this.pendingIdentities.delete(sessionId);
    void this.statusWatch.refresh(sessionId);
    this.notify();
  }

  /** 快相位:spawn 后 15s 内 500ms 一格扫盘;扫不尽由慢相位(2s 巡航)继续,会话不死探测不止。 */
  private async detectDiskIdentity(sessionId: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 500);
      await promise;
      if (!this.pendingIdentities.has(sessionId)) return; // 已绑定或会话已死
      await this.tryBindIdentity(sessionId);
    }
  }

  /** 缓冲上限兜底值(设置未落地前/异常时)。全屏 TUI 靠重绘恢复，保留尾部足够。 */
  private static readonly OUTPUT_BUFFER_LIMIT = 500_000;

  private appendOutput(sessionId: string, text: string): void {
    /* 上限读设置项 sessionOutputBufferLimit(行为页可调),异常值已被 sanitize 拦截。 */
    const limit =
      getSettingsState().settings.sessionOutputBufferLimit || Host.OUTPUT_BUFFER_LIMIT;
    this.outputBuffers.append(sessionId, text, limit);
    this.events.emit(ptyLiveTopic(sessionId), text);

    /* AskWatch:命中面板标记立候选,复现确认后升级等待 → 事件 + 标签重渲染;
       ActivityWatch:输出回绿 + 节流 notify(未锚定会话免重渲染)。 */
    const asked = this.askWatch.onOutput(sessionId, text);
    if (asked) this.events.emit(KernelTopics.askDetected, sessionId);
    if (asked || this.activity.onOutput(sessionId)) this.notify();
  }

  /**
   * 用户输入的唯一写入口:PTY 写入 + 对话锚定(呼吸灯首写闸,activityWatch)
   * + Ask 等待解除(作答即摘标签)。
   * synthetic = 终端协议回传(焦点/鼠标/查询应答,见 terminalReports.ts):
   * 照常写 PTY(CLI 正在等),但不锚定对话 —— 点一下终端/滚一轮不算用户首写。
   */
  writeSession(sessionId: string, data: string, synthetic = false): void {
    void ipc.sessionWrite(sessionId, data);
    if (!synthetic) this.activity.onUserWrite(sessionId);
    if (this.askWatch.onUserWrite(sessionId)) this.notify();
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.activity.isUnread(sessionId);
  }

  /** 等待确认判定(会话列表「等待确认」标签;用户写入即清)。 */
  isWaitingConfirm = (sessionId: string): boolean => this.askWatch.isWaiting(sessionId);

  /** 测试专用:假时钟换届时重置活动守望与 Ask 守望(与 resetStatusTimerForTest 同因)。 */
  resetActivityWatchForTest(): void {
    this.activity.resetForTest();
    this.askWatch.resetForTest();
  }

  /** 会话至今的全部（尾部）输出，供 xterm 重挂载回放（压实语义见 OutputBufferStore.get）。 */
  getOutputBuffer(sessionId: string): string {
    return this.outputBuffers.get(sessionId);
  }

  /**
   * 缓冲的 UTF-8 字节数(增量维护,O(1) 读取)。
   * 供 TerminalView 翻页锚点反推缓冲起点的绝对日志偏移。
   */
  getOutputBufferBytes(sessionId: string): number {
    return this.outputBuffers.getBytes(sessionId);
  }

  /** 窗口聚焦态馈入(main.tsx 挂 focus/blur):重聚焦即视激活会话为已读(蓝灯让位)。 */
  setWindowFocus(focused: boolean): void {
    if (this.windowFocused === focused) return;
    this.windowFocused = focused;
    if (focused && this.activeSessionId) this.activity.markViewed(this.activeSessionId);
    this.notify();
  }

  /** 会话最近输出时间戳（无输出为 0）。 */
  getLastActivityAt(sessionId: string): number {
    return this.activity.lastActivityAt(sessionId);
  }

  /** 测试专用:假时钟换届时重置巡航计时器(真实运行单例连续,无需调用)。 */
  resetStatusTimerForTest(): void {
    this.statusWatch.resetTimerForTest();
  }

  setActiveSession(id: string | null): void {
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    /* 点开查看 = 已读:清完成未读标记(蓝 → 灰) */
    if (id) this.activity.markViewed(id);
    this.events.emit(KernelTopics.activeSessionChanged, id);
    if (id) {
      this.statusWatch.ensurePolling();
      void this.statusWatch.refresh(id);
    }
    this.notify();
  }

  async removeSession(id: string): Promise<void> {
    await ipc.sessionKill(id).catch(() => undefined);
    this.ptyUnlistens.get(id)?.forEach((off) => off());
    this.ptyUnlistens.delete(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.cliSessionIds.delete(id);
    this.pendingIdentities.delete(id);
    this.statusWatch.remove(id);
    this.outputBuffers.remove(id);
    this.activity.onSessionRemoved(id);
    this.askWatch.onSessionRemoved(id);
    if (this.activeSessionId === id) {
      const next = this.sessions[0]?.id ?? null;
      this.activeSessionId = next;
      /* 隐式切换也要广播(含删尽转 null):EventBus 是跨插件唯一通道,陈旧 id 误导订阅方 */
      this.events.emit(KernelTopics.activeSessionChanged, next);
    }
    this.events.emit(KernelTopics.sessionsChanged, this.sessions);
    this.notify();
  }

  // ---- React 绑定（useSyncExternalStore，免引入状态库） --------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private version = 0;
  getVersion = (): number => this.version;

  private notify(): void {
    this.version += 1;
    this.listeners.forEach((fn) => fn());
  }
}

/** 全局唯一宿主实例。 */
export const host = new Host();
/** 幕布实时输出 topic（TerminalView 订阅，与 appendOutput 共用）。 */
export function ptyLiveTopic(sessionId: string): string {
  return `kernel.pty.live.${sessionId}`;
}

/** React 组件订阅宿主变化的 Hook。 */
export function useHost(): number {
  return useSyncExternalStore(host.subscribe, host.getVersion);
}
