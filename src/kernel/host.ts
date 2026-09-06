/**
 * 宿主 —— 插件注册表 + 挂载点注册表 + 会话服务的装配点。
 * 内核不 import 任何插件;插件清单在 src/plugins/index.ts,main.tsx 启动激活。
 *
 * 文件规模铁则拆分(300 行):五守望与 appendOutput 主链路在 hostWatches.ts,
 * ssh/shell/spawn 会话服务接线在 hostSessionServices.ts;本文件留注册表、
 * 查询门面与 PTY 生命周期的公开语义。
 */

import { useSyncExternalStore } from "react";
import { EventBus, KernelTopics } from "./events";
import { getSettingsState } from "./settings";
import { HostRegistry } from "./hostRegistry";
import { HostWatches } from "./hostWatches";
import { createSessionServices } from "./hostSessionServices";

import { ipc, type SshHostConfig, type SessionMeta } from "./ipc";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";
import { registerSettingsSection } from "./settingsRegistry";
import { registerFilePanel } from "./filePanel";
import { registerTabContent } from "./tabs";
import { registerFileVisual } from "./fileVisual";
import { registerMarketPanel } from "./marketPanel";
import type { SidebarAction } from "./sidebarActions";
import { registerCommand } from "./shortcuts";

class Host implements PluginContext {
  readonly events = new EventBus();

  private sessions: SessionMeta[] = [];
  private activeSessionId: string | null = null;
  private listeners = new Set<() => void>();
  /** PTY 事件退订表:spawn 登记输出/退出两监听,会话移除成对退订
   * (此前 void 掉 listen 的 UnlistenFn,每次 spawn 泄漏 2 个监听器)。 */
  private ptyUnlistens = new Map<string, Array<() => void>>();
  /** 窗口聚焦态(main.tsx 挂 focus/blur 监听馈入):失焦时激活会话完成也视为未查看。 */
  private windowFocused = true;
  /** CLI profile/挂载点注册表与插件生命周期:拆分件 kernel/hostRegistry.ts(文件规模铁则)。 */
  private readonly registry = new HostRegistry(() => this.notify());
  /** 五守望 + appendOutput 主链路:拆分件 kernel/hostWatches.ts(文件规模铁则)。 */
  private readonly watches = new HostWatches({
    getCliProfile: (profileId) => this.registry.getCliProfile(profileId),
    findSession: (sessionId) => this.sessions.find((s) => s.id === sessionId),
    hasSession: (sessionId) => this.sessions.some((s) => s.id === sessionId),
    getActiveSessionId: () => this.activeSessionId,
    /* 后台提醒开启时,窗口失焦的激活会话不算"正在查看"(完成照标蓝/响结束音);
       Node 测试环境 windowFocused 恒 true,退化为纯 activeSessionId 语义 */
    isViewing: (id) =>
      id === this.activeSessionId &&
      (!getSettingsState().settings.backgroundNotify || this.windowFocused),
    notify: () => this.notify(),
    events: this.events,
  });
  /** ssh/shell/spawn 会话服务装配:拆分件 kernel/hostSessionServices.ts(文件规模铁则)。 */
  private readonly sessionServices = createSessionServices(
    {
      refreshSessions: async () => {
        this.sessions = await ipc.sessionList();
      },
      getSessions: () => this.sessions,
      setSessions: (sessions) => (this.sessions = sessions),
      findSession: (sessionId) => this.sessions.find((s) => s.id === sessionId),
      getCliProfile: (id) => this.getCliProfile(id),
      setActiveSessionId: (id) => (this.activeSessionId = id),
      setActiveSession: (id) => this.setActiveSession(id),
      removeSession: (sessionId) => this.removeSession(sessionId),
      trackUnlisten: (sessionId, offs) => this.ptyUnlistens.set(sessionId, offs),
      notify: () => this.notify(),
    },
    this.watches,
    this.events,
  );

  // ---- PluginContext 实现 -------------------------------------------------

  registerCliProfile(profile: CliProfile): void {
    this.registry.registerCliProfile(profile);
  }

  contribute(point: MountPoint, contribution: MountContribution): void {
    this.registry.contribute(point, contribution);
  }
  /* 注册表通道自驱动通知(或 activate 期登记),纯委托即可;sidebarAction 的
     无键位命令镜像逻辑在 hostRegistry(注释亦随迁)。 */
  registerSettingsSection = registerSettingsSection;
  registerFilePanel = registerFilePanel;
  registerTabContent = registerTabContent;
  registerMarketPanel = registerMarketPanel;
  registerSidebarAction = (action: SidebarAction): void =>
    this.registry.registerSidebarAction(action);
  registerFileVisual = registerFileVisual;
  registerCommand = registerCommand;

  // ---- 插件生命周期(委托 kernel/hostRegistry) ----------------------------

  activateAll(plugins: Plugin[]): Promise<void> {
    return this.registry.activateAll(plugins, this);
  }

  // ---- 查询(外壳/插件消费) ----------------------------------------------

  getCliProfiles(): CliProfile[] {
    return this.registry.getCliProfiles();
  }

  getCliProfile(id: string): CliProfile | undefined {
    return this.registry.getCliProfile(id);
  }

  getMount(point: MountPoint): MountContribution[] {
    return this.registry.getMount(point);
  }
  /** 插件市场数据源(委托 registry)。 */
  listPluginStates(): { plugin: Plugin; enabled: boolean }[] {
    return this.registry.listPluginStates();
  }
  /** 插件是否已激活(委托 registry):拔插语义查询,门控应配合 dependsOn 声明。 */
  isPluginActive = (id: string): boolean => this.registry.isPluginActive(id);

  getSessions(): SessionMeta[] {
    return this.sessions;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getSessionStatus(sessionId: string): CliSessionStatus | undefined {
    return this.watches.getSessionStatus(sessionId);
  }

  /** 状态值来源:"seeded" = CLI 默认配置种子,"observed" = 会话文件真实观测。 */
  getSessionStatusSource(sessionId: string): "seeded" | "observed" | undefined {
    return this.watches.getSessionStatusSource(sessionId);
  }

  /** 活会话绑定的 CLI 磁盘身份;未绑定(探测前)为 undefined。 */
  getCliSessionId(sessionId: string): string | undefined {
    return this.watches.getCliSessionId(sessionId);
  }

  /** 测试专用:直通绑定终审闸(共绑一磁盘身份的回归入口)。 */
  bindIdentityForTest(sessionId: string, cliSessionId: string): boolean {
    return this.watches.bindIdentityForTest(sessionId, cliSessionId);
  }

  // ---- 会话服务(kernel 固有职责:PTY 生命周期) ---------------------------

  /** 创建/重连 SSH 一等会话(实现见 kernel/sshSessions.ts);幕布与 PTY 同构,无 profile。 */
  async createSshSession(host: SshHostConfig, workspaceId?: string): Promise<SessionMeta>;
  async createSshSession(reconnectOf: string, workspaceId?: string): Promise<SessionMeta>;
  async createSshSession(
    host: SshHostConfig | string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    return this.sessionServices.ssh.create(host, workspaceId);
  }

  /** 新建内置终端会话(实现见 kernel/shellSessions.ts);本地默认 shell,幕布即输入面。 */
  async createShellSession(workspaceId?: string): Promise<SessionMeta> {
    return this.sessionServices.shell.create(workspaceId);
  }

  async createSession(
    profileId: string,
    cwd: string,
    workspaceId?: string,
  ): Promise<SessionMeta> {
    return this.sessionServices.spawn.create(profileId, cwd, workspaceId);
  }

  /** 打开 CLI 磁盘历史会话(resume);实现见 kernel/sessionSpawn.ts。 */
  async openDiskSession(
    profileId: string,
    cwd: string,
    workspaceId: string | undefined,
    cliSessionId: string,
  ): Promise<SessionMeta> {
    return this.sessionServices.spawn.open(profileId, cwd, workspaceId, cliSessionId);
  }

  /* 回放补观察 / 屏幕采样:委托守望组合件(语义见 kernel/askWatch.ts)。 */
  observeReplayTail = (sessionId: string): void =>
    this.watches.observeReplayTail(sessionId);
  observeAskScreen = (sessionId: string, screenText: string): void =>
    this.watches.observeAskScreen(sessionId, screenText);

  /** 用户输入的唯一写入口:PTY 写入 + 对话锚定(呼吸灯首写闸)+ Ask 作答解除。 */
  writeSession(sessionId: string, data: string, synthetic = false): void {
    void ipc.sessionWrite(sessionId, data);
    if (this.watches.onUserWrite(sessionId, synthetic)) this.notify();
  }

  /** 幕布尺寸同步的唯一入口(TerminalView):转发 resize + 给活动守望记重绘抑制窗起点。 */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    this.watches.onResized(sessionId);
    void ipc.sessionResize(sessionId, cols, rows);
  }

  /** 完成未读判定(会话列表蓝呼吸灯)。 */
  isUnread(sessionId: string): boolean {
    return this.watches.isUnread(sessionId);
  }

  /** 等待确认判定(会话列表「等待确认」标签;用户写入即清)。 */
  isWaitingConfirm = (sessionId: string): boolean =>
    this.watches.isWaiting(sessionId);

  /** 测试专用:假时钟换届时重置活动守望与 Ask 守望(与 resetStatusTimerForTest 同因)。 */
  resetActivityWatchForTest(): void {
    this.watches.resetActivityWatchForTest();
  }

  /** 会话至今的全部(尾部)输出,供 xterm 重挂载回放(压实语义见 OutputBufferStore.get)。 */
  getOutputBuffer(sessionId: string): string {
    return this.watches.getOutputBuffer(sessionId);
  }

  /**
   * 缓冲的 UTF-8 字节数(增量维护,O(1) 读取)。
   * 供 TerminalView 翻页锚点反推缓冲起点的绝对日志偏移。
   */
  getOutputBufferBytes(sessionId: string): number {
    return this.watches.getOutputBufferBytes(sessionId);
  }

  /** 窗口聚焦态馈入(main.tsx 挂 focus/blur):重聚焦即视激活会话为已读(蓝灯让位)。 */
  setWindowFocus(focused: boolean): void {
    if (this.windowFocused === focused) return;
    this.windowFocused = focused;
    if (focused && this.activeSessionId) this.watches.markViewed(this.activeSessionId);
    this.notify();
  }

  /** 会话最近输出时间戳(无输出为 0)。 */
  getLastActivityAt(sessionId: string): number {
    return this.watches.lastActivityAt(sessionId);
  }

  /** 测试专用:假时钟换届时重置巡航计时器(真实运行单例连续,无需调用)。 */
  resetStatusTimerForTest(): void {
    this.watches.resetStatusTimerForTest();
  }

  setActiveSession(id: string | null): void {
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    /* 点开查看 = 已读:清完成未读标记(蓝 → 灰) */
    if (id) this.watches.markViewed(id);
    this.events.emit(KernelTopics.activeSessionChanged, id);
    if (id) {
      this.watches.statusEnsurePolling();
      this.watches.statusRefresh(id);
    }
    this.notify();
  }

  async removeSession(id: string): Promise<void> {
    await ipc.sessionKill(id).catch(() => undefined);
    this.ptyUnlistens.get(id)?.forEach((off) => off());
    this.ptyUnlistens.delete(id);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.watches.onSessionRemoved(id);
    if (this.activeSessionId === id) {
      const next = this.sessions[0]?.id ?? null;
      this.activeSessionId = next;
      /* 隐式切换也要广播(含删尽转 null):EventBus 是跨插件唯一通道,陈旧 id 误导订阅方 */
      this.events.emit(KernelTopics.activeSessionChanged, next);
    }
    this.events.emit(KernelTopics.sessionsChanged, this.sessions);
    this.notify();
  }

  // ---- React 绑定(useSyncExternalStore,免引入状态库) --------------------

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
/** 幕布实时输出 topic(移居 hostWatches.ts;re-export 保持 import 契约)。 */
export { ptyLiveTopic } from "./hostWatches";

/** React 组件订阅宿主变化的 Hook。 */
export function useHost(): number {
  return useSyncExternalStore(host.subscribe, host.getVersion);
}
