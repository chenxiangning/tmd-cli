/**
 * 宿主 —— 插件注册表 + 挂载点注册表 + 会话服务的装配点。
 * 内核不 import 任何插件;插件清单在 src/plugins/index.ts,main.tsx 启动激活。
 */

import { useSyncExternalStore } from "react";
import { EventBus, KernelTopics } from "./events";
import { getSettingsState } from "./settings";
import { PluginLifecycle } from "./pluginLifecycle";
import { ActivityWatch } from "./activityWatch";
import { AskWatchFeed } from "./askWatch";
import { EditWatch } from "./editWatch";
import { DiskIdentityWatch } from "./identityWatch";
import { OutputBufferStore } from "./outputBuffers";
import { SessionStatusWatch } from "./sessionStatus";
import { SshSessionService } from "./sshSessions";

import { ipc, type SshHostConfig, type SessionMeta } from "./ipc";
import { SessionSpawnService } from "./sessionSpawn";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";
import { registerSettingsSection } from "./settingsRegistry";
import { registerFilePanel } from "./filePanel";
import { registerTabContent } from "./tabs";
import { registerFileVisual } from "./fileVisual";
import { registerSidebarAction } from "./sidebarActions";
import { registerQuotaProvider } from "./quota";

class Host implements PluginContext {
  readonly events = new EventBus();

  private cliProfiles = new Map<string, CliProfile>();
  private mounts = new Map<MountPoint, MountContribution[]>();
  private sessions: SessionMeta[] = [];
  private activeSessionId: string | null = null;
  /** 待绑定磁盘身份的会话探测(快相位 500ms×30 → 巡航 5s,预算 10min);实现见 kernel/identityWatch.ts。 */
  private readonly identityWatch = new DiskIdentityWatch({
    getCliProfile: (profileId) => this.cliProfiles.get(profileId),
    sessionAlive: (sessionId) => this.sessions.some((s) => s.id === sessionId),
    isBound: (sessionId) => this.cliSessionIds.has(sessionId),
    claimedIds: () => new Set(this.cliSessionIds.values()),
    onBound: (sessionId, cliSessionId) => {
      this.bindIdentity(sessionId, cliSessionId);
      void this.statusWatch.refresh(sessionId);
      this.notify();
    },
  });
  /** 活会话对应的 CLI 当前模型/思考强度与来源分级(实现见 kernel/sessionStatus.ts)。 */
  private readonly statusWatch = new SessionStatusWatch({
    getActiveSessionId: () => this.activeSessionId,
    findSession: (sessionId) => this.sessions.find((s) => s.id === sessionId),
    hasSession: (sessionId) => this.sessions.some((s) => s.id === sessionId),
    getCliProfile: (profileId) => this.cliProfiles.get(profileId),
    getCliSessionId: (sessionId) => this.cliSessionIds.get(sessionId),
    isPendingIdentity: (sessionId) => this.identityWatch.has(sessionId),
    tryBindIdentity: (sessionId) => this.identityWatch.tryBind(sessionId),
    notify: () => this.notify(),
  });
  private listeners = new Set<() => void>();
  /** 每会话 PTY 输出环形缓冲:xterm 重挂载回放("切回不黑屏");存储细节见 kernel/outputBuffers.ts。 */
  private readonly outputBuffers = new OutputBufferStore();
  private readonly askWatch = new AskWatchFeed({
    sessionKind: (sessionId) =>
      this.sessions.find((s) => s.id === sessionId)?.kind,
    askMarks: (sessionId) =>
      this.cliProfiles.get(
        this.sessions.find((s) => s.id === sessionId)?.profileId ?? "",
      )?.askMarks,
    emitAsked: (sessionId) => this.events.emit(KernelTopics.askDetected, sessionId),
    notify: () => this.notify(),
    bufferTail: (sessionId, maxChars) =>
      this.outputBuffers.get(sessionId).slice(-maxChars), // askWatch 检测核心见 kernel/askWatch.ts
  });
  /** AI 写入文件守望(events 归因主信号,见 kernel/editWatch.ts;纯内存,随 PTY 消亡) */
  private readonly editWatch = new EditWatch();
  /**
   * 活会话 → CLI 磁盘身份绑定(omp/pi 的 jsonl uuid、codex 的 rollout id)。
   * 纯前端内存,随 PTY 消亡 —— 这是活会话的身份属性,不是持久化映射。
   * 用途:UI 按身份去重(同一会话在活区/磁盘区只出现一次)。
   */
  private cliSessionIds = new Map<string, string>();

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  getCliSessionId(sessionId: string): string | undefined {
    return this.cliSessionIds.get(sessionId);
  }

  /**
   * 绑定表唯一写入口:一个 CLI 磁盘身份只准一个活会话持有。身份守望的
   * claimed 过滤是快照式(await 期间会过期),此处是绑定落表的同步终审
   * (实证:四会话共绑一老会话,ptys 各自 resume 了同一磁盘会话)。
   * 抢绑失败 = 新会话保持未绑定(fail-closed):账本按 tmd id 隔离,
   * UI 不去重,不与既有会话并账。
   */
  private bindIdentity(sessionId: string, cliSessionId: string): boolean {
    const rival = [...this.cliSessionIds.entries()].some(
      ([id, cid]) => id !== sessionId && cid === cliSessionId,
    );
    if (rival) return false;
    this.cliSessionIds.set(sessionId, cliSessionId);
    return true;
  }

  /** 测试专用:直通绑定终审闸(共绑一磁盘身份的回归入口)。 */
  bindIdentityForTest(sessionId: string, cliSessionId: string): boolean {
    return this.bindIdentity(sessionId, cliSessionId);
  }
  /**
   * PTY 事件退订表:spawn 时登记输出/退出两个全局监听,会话移除时成对退订。
   * 此前 void 掉 listen 的 UnlistenFn,每次 spawn 泄漏 2 个监听器。
   */
  private ptyUnlistens = new Map<string, Array<() => void>>();
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
    /* quota 抓取器随 profile.fetchQuota 声明(同 listSuggestions 惯例),统一接线进 kernel/quota。 */
    if (profile.fetchQuota) {
      registerQuotaProvider({ profileId: profile.id, fetch: profile.fetchQuota });
    }
    this.notify();
  }

  contribute(point: MountPoint, contribution: MountContribution): void {
    const list = this.mounts.get(point) ?? [];
    list.push(contribution);
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.mounts.set(point, list);
    this.notify();
  }
  /* 注册表通道自驱动通知(或 activate 期登记),纯委托即可。 */
  registerSettingsSection = registerSettingsSection;
  registerFilePanel = registerFilePanel;
  registerTabContent = registerTabContent;
  registerSidebarAction = registerSidebarAction;
  registerFileVisual = registerFileVisual;

  // ---- 插件生命周期(委托 kernel/pluginLifecycle) ----------------------------

  private lifecycle = new PluginLifecycle();

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
  /** 插件是否已激活(委托 lifecycle):拔插语义查询,门控应配合 dependsOn 声明。 */
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

  /** SSH 会话创建/装配:拆分件 kernel/sshSessions.ts(文件规模铁则)。 */
  private readonly sshSessions = new SshSessionService(
    {
      refreshSessions: async () => {
        this.sessions = await ipc.sessionList();
      },
      findSession: (sessionId) => this.sessions.find((s) => s.id === sessionId),
      appendOutput: (sessionId, text) => this.appendOutput(sessionId, text),
      removeSession: (sessionId) => this.removeSession(sessionId),
      trackUnlisten: (sessionId, offs) => this.ptyUnlistens.set(sessionId, offs),
      getSessions: () => this.sessions,
      notify: () => this.notify(),
    },
    this.events,
  );

  /** 创建/重连 SSH 一等会话(实现见 kernel/sshSessions.ts);幕布与 PTY 同构,无 profile。 */
  async createSshSession(host: SshHostConfig, workspaceId?: string): Promise<SessionMeta>;
  async createSshSession(reconnectOf: string, workspaceId?: string): Promise<SessionMeta>;
  async createSshSession(
    host: SshHostConfig | string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    return this.sshSessions.create(host, workspaceId);
  }

  /** 本地 CLI 会话 spawn 编排 + 秒退守望:拆分件 kernel/sessionSpawn.ts(文件规模铁则)。 */
  private readonly spawn = new SessionSpawnService(
    {
      getCliProfile: (id) => this.getCliProfile(id),
      getSessions: () => this.sessions,
      setSessions: (sessions) => (this.sessions = sessions),
      setActiveSessionId: (id) => (this.activeSessionId = id),
      setActiveSession: (id) => this.setActiveSession(id),
      bindIdentity: (sessionId, cliSessionId) => this.bindIdentity(sessionId, cliSessionId),
      getCliSessionId: (sessionId) => this.cliSessionIds.get(sessionId),
      identityTrack: (sessionId, profileId, cwd, before, spawnedAt) =>
        this.identityWatch.track(sessionId, profileId, cwd, before, spawnedAt),
      statusEnsurePolling: () => this.statusWatch.ensurePolling(),
      statusRefresh: (sessionId) => void this.statusWatch.refresh(sessionId),
      statusSeed: (sessionId) => void this.statusWatch.seed(sessionId),
      trackUnlisten: (sessionId, offs) => this.ptyUnlistens.set(sessionId, offs),
      outputTail: (sessionId, maxChars) => this.outputBuffers.get(sessionId).slice(-maxChars),
      appendOutput: (sessionId, text) => this.appendOutput(sessionId, text),
      removeSession: (sessionId) => this.removeSession(sessionId),
      notify: () => this.notify(),
    },
    this.events,
  );

  async createSession(
    profileId: string,
    cwd: string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    return this.spawn.create(profileId, cwd, workspaceId);
  }

  /** 打开 CLI 磁盘历史会话(resume);实现见 kernel/sessionSpawn.ts。 */
  async openDiskSession(
    profileId: string,
    cwd: string,
    workspaceId: string | undefined,
    cliSessionId: string,
  ): Promise<SessionMeta> {
    return this.spawn.open(profileId, cwd, workspaceId, cliSessionId);
  }

  // ---- 身份探测:kernel/identityWatch.ts(文件规模铁则拆分) ---------------

  /** 缓冲上限兜底值(设置未落地前/异常时)。全屏 TUI 靠重绘恢复，保留尾部足够。 */
  private static readonly OUTPUT_BUFFER_LIMIT = 500_000;

  private appendOutput(sessionId: string, text: string): void {
    /* 上限读设置项 sessionOutputBufferLimit(行为页可调),异常值已被 sanitize 拦截。 */
    const limit =
      getSettingsState().settings.sessionOutputBufferLimit || Host.OUTPUT_BUFFER_LIMIT;
    const chunkBytes = this.outputBuffers.append(sessionId, text, limit);
    this.events.emit(ptyLiveTopic(sessionId), text);

    /* AskWatch 升级 → askDetected(提示音)+ 标签;ActivityWatch 回绿;
       EditWatch 检测 AI 写入标记 → fileEditDetected(审批线归因)。
       notify 单次:ask 升级与回绿共享同一渲染节拍。 */
    const asked = this.askWatch.onOutput(sessionId, text, chunkBytes);
    if (asked || this.activity.onOutput(sessionId)) this.notify();
    const session = this.sessions.find((s) => s.id === sessionId);
    const marks = session ? this.cliProfiles.get(session.profileId)?.editMarks : undefined;
    if (session && marks && marks.length > 0) {
      const paths = this.editWatch.onOutput(sessionId, text, session.cwd, marks);
      if (paths.length > 0) {
        this.events.emit(KernelTopics.fileEditDetected, { sessionId, paths });
      }
    }
  }

  /* 回放补观察 / 屏幕采样:委托 askWatch 组合件(语义见 kernel/askWatch.ts)。 */
  observeReplayTail = (sessionId: string): void =>
    this.askWatch.observeReplayTail(sessionId);
  observeAskScreen = (sessionId: string, screenText: string): void =>
    this.askWatch.onScreenSample(sessionId, screenText);

  /** 用户输入的唯一写入口:PTY 写入 + 对话锚定(呼吸灯首写闸)+ Ask 作答解除。 */
  writeSession(sessionId: string, data: string, synthetic = false): void {
    void ipc.sessionWrite(sessionId, data);
    if (!synthetic) {
      this.activity.onUserWrite(sessionId);
      this.editWatch.onUserWrite(sessionId); // 新一轮:EditWatch 去重集清空
    }
    if (this.askWatch.onUserWrite(sessionId)) this.notify();
  }

  /** 幕布尺寸同步的唯一入口(TerminalView):转发 resize + 给活动守望记重绘抑制窗起点。 */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    this.activity.onResized(sessionId);
    void ipc.sessionResize(sessionId, cols, rows);
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
    this.identityWatch.remove(id);
    this.statusWatch.remove(id);
    this.outputBuffers.remove(id);
    this.activity.onSessionRemoved(id);
    this.askWatch.onSessionRemoved(id);
    this.editWatch.onSessionRemoved(id); // 无条件清:非激活会话移除同样不得泄漏检测态
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
