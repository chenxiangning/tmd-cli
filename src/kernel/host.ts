/**
 * 宿主 —— 插件注册表 + 挂载点注册表 + 会话服务的装配点。
 *
 * 内核不 import 任何插件；插件清单在 src/plugins/index.ts，
 * main.tsx 启动时一次性注册激活。
 */

import { useSyncExternalStore } from "react";
import { EventBus, KernelTopics } from "./events";
import { sliceStreamTail } from "./streamSlice";
import { getSettingsState } from "./settings";

import { ipc, onPtyExit, onPtyOutput, type SessionMeta, type SpawnSpec } from "./ipc";
import type { CliProfile, CliSessionStatus } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";
import {
  registerSettingsSection,
  type SettingsSectionContribution,
} from "./settingsRegistry";

/** 输出缓冲的分块结构:chunks 按到达顺序排列,totalChars/totalBytes 为增量维护的合计。 */
interface OutputBuffer {
  chunks: string[];
  totalChars: number;
  totalBytes: number;
}

/** 共享 TextEncoder:appendOutput 逐 chunk 累计 UTF-8 字节数(TextEncoder 无线程语义,复用安全)。 */
const outputByteEncoder = new TextEncoder();

class Host implements PluginContext {
  readonly events = new EventBus();

  private plugins = new Map<string, Plugin>();
  private cliProfiles = new Map<string, CliProfile>();
  private mounts = new Map<MountPoint, MountContribution[]>();
  private sessions: SessionMeta[] = [];
  private activeSessionId: string | null = null;
  /** 活会话对应的 CLI 当前模型/思考强度,由 profile 只读读取。 */
  private sessionStatuses = new Map<string, CliSessionStatus>();
  private statusTimer: number | null = null;
  private listeners = new Set<() => void>();
  /**
   * 每会话 PTY 输出环形缓冲：会话切换后 xterm 重挂载靠它回放，这是"切回不黑屏"的核心。
   * 分块存储:append 只 push 不拼接(高频路径零复制);totalBytes 随 chunk 增量维护,
   * 供 TerminalView 翻页锚点反推,消除挂载时全量 TextEncoder 编码。
   * totalChars 超 1.2×limit 才 join+截断一次,平摊 O(limit)。
   */
  private outputBuffers = new Map<string, OutputBuffer>();
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

  /** 每会话最近输出时间：驱动会话列表呼吸灯。 */
  private lastActivityAt = new Map<string, number>();
  /** 呼吸灯 notify 节流记录。 */
  private lastActivityNotify = new Map<string, number>();

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

  // ---- 插件生命周期 -------------------------------------------------------

  /** 并发闸：StrictMode 双调用会在首个 await 处交错，已激活过滤挡不住，必须共享同一个激活 Promise。 */
  private activation: Promise<void> | null = null;

  activateAll(plugins: Plugin[]): Promise<void> {
    if (!this.activation) {
      this.activation = this.doActivateAll(plugins);
    }
    return this.activation;
  }

  private async doActivateAll(plugins: Plugin[]): Promise<void> {
    // 幂等：已激活的插件直接跳过（热更新场景）；
    // registerCliProfile 的重复检查仍然保留，用于拦截两个不同插件抢同一 id 的真冲突。
    const pending = new Map(
      plugins.filter((p) => !this.plugins.has(p.id)).map((p) => [p.id, p]),
    );
    while (pending.size > 0) {
      let progressed = false;
      for (const [id, plugin] of pending) {
        const ready = (plugin.dependsOn ?? []).every((d) => this.plugins.has(d));
        if (!ready) continue;
        await plugin.activate(this);
        this.plugins.set(id, plugin);
        pending.delete(id);
        progressed = true;
      }
      if (!progressed) {
        throw new Error(
          `插件依赖环或缺失: ${[...pending.keys()].join(", ")}`,
        );
      }
    }
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

  getSessions(): SessionMeta[] {
    return this.sessions;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getSessionStatus(sessionId: string): CliSessionStatus | undefined {
    return this.sessionStatuses.get(sessionId);
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
    // 快照既有磁盘会话:spawn 后 CLI 会新落盘一个文件,据此把磁盘身份绑到活会话
    const before = profile.listSessions
      ? new Set(
          (await profile.listSessions(cwd).catch(() => [])).map((s) => s.id),
        )
      : null;
    const spawned = await ipc.sessionSpawn(profileId, spec, workspaceId);
    if (before) void this.detectDiskIdentity(spawned.id, profile, cwd, before);
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
    const args = profile.resumeArgs?.(cliSessionId) ?? profile.args;
    const spec: SpawnSpec = {
      command: profile.command,
      args,
      cwd,
      env: profile.env,
    };
    const spawned = await ipc.sessionSpawn(profileId, spec, workspaceId);
    return this.adoptSpawned(spawned.id, cliSessionId);
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
    void onPtyOutput(sessionId, (text) => this.appendOutput(sessionId, text));
    onPtyExit(sessionId, () => {
      void this.removeSession(sessionId);
      this.events.emit(KernelTopics.sessionExited, sessionId);
    });
    this.events.emit(KernelTopics.sessionsChanged, this.sessions);
    this.events.emit(KernelTopics.activeSessionChanged, sessionId);
    this.notify();
    this.ensureStatusPolling();
    void this.refreshSessionStatus(sessionId);
    return this.sessions.find((s) => s.id === sessionId)!;
  }

  /**
   * spawn 后轮询磁盘,把 CLI 新落盘的会话身份绑到活会话上。最多 30 次 × 500ms。
   * 判定:出现 before 快照里不存在、且未被其他活会话认领的会话 id。
   *
   * 竞态防线(实证:多会话 15s 探测窗口重叠时状态条模型/思考永久丢失):
   * 1. 绑定成功即终 —— 继续轮询会把后续新会话的身份抢绑到本会话;
   * 2. 认领集排除 —— 并发 spawn 同 cwd 时,晚到的探测不得抢绑已认领身份;
   * 3. 取最旧的未认领 fresh —— 文件按落盘顺序对应 spawn 顺序,先 spawn 先认领。
   */
  private async detectDiskIdentity(
    sessionId: string,
    profile: CliProfile,
    cwd: string,
    before: ReadonlySet<string>,
  ): Promise<void> {
    if (!profile.listSessions) return;
    for (let i = 0; i < 30; i++) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 500);
      await promise;
      if (!this.sessions.some((s) => s.id === sessionId)) return; // PTY 已死
      if (this.cliSessionIds.has(sessionId)) return; // 已绑定(防御:身份一经确认不再改)
      const list = await profile.listSessions(cwd).catch(() => []);
      const claimed = new Set(this.cliSessionIds.values());
      /* listSessions 按 mtime 倒序 → 倒着找 = 最旧的未认领 fresh */
      const fresh = list.findLast((s) => !before.has(s.id) && !claimed.has(s.id));
      if (!fresh) continue;
      this.cliSessionIds.set(sessionId, fresh.id);
      void this.refreshSessionStatus(sessionId);
      this.notify();
      return;
    }
  }

  /** 缓冲上限兜底值(设置未落地前/异常时)。全屏 TUI 靠重绘恢复，保留尾部足够。 */
  private static readonly OUTPUT_BUFFER_LIMIT = 500_000;

  private appendOutput(sessionId: string, text: string): void {
    const buf: OutputBuffer = this.outputBuffers.get(sessionId) ?? {
      chunks: [],
      totalChars: 0,
      totalBytes: 0,
    };
    buf.chunks.push(text);
    buf.totalChars += text.length;
    /* 逐 chunk 编码累计字节数:PTY 侧按完整码点切包(decode_utf8_chunk 暂存尾部),
       chunk 边界永不劈开 surrogate pair,故分块编码之和 === 拼接后整段编码 */
    buf.totalBytes += outputByteEncoder.encode(text).length;
    /* 上限读设置项 sessionOutputBufferLimit(行为页可调),异常值已被 sanitize 拦截。
       1.2× 迟滞:只有明显超限才合并截断,避免每次 append 都做 O(limit) 拼接 */
    const limit =
      getSettingsState().settings.sessionOutputBufferLimit || Host.OUTPUT_BUFFER_LIMIT;
    if (buf.totalChars > limit * 1.2) {
      const trimmed = sliceStreamTail(buf.chunks.join(""), limit);
      buf.chunks = [trimmed];
      buf.totalChars = trimmed.length;
      buf.totalBytes = outputByteEncoder.encode(trimmed).length;
    }
    this.outputBuffers.set(sessionId, buf);
    this.events.emit(ptyLiveTopic(sessionId), text);

    const now = Date.now();
    this.lastActivityAt.set(sessionId, now);
    // 呼吸灯节流：每会话 500ms 最多触发一次外壳重渲染
    if (now - (this.lastActivityNotify.get(sessionId) ?? 0) > 500) {
      this.lastActivityNotify.set(sessionId, now);
      this.notify();
    }
  }

  /** 会话至今的全部（尾部）输出，供 xterm 重挂载回放。join 后顺手压实为单 chunk。 */
  getOutputBuffer(sessionId: string): string {
    const buf = this.outputBuffers.get(sessionId);
    if (!buf) return "";
    if (buf.chunks.length === 1) return buf.chunks[0];
    const joined = buf.chunks.join("");
    buf.chunks = [joined]; // 回放即压实:后续 append 继续在单块上增长
    return joined;
  }

  /**
   * 缓冲的 UTF-8 字节数(增量维护,O(1) 读取)。
   * 供 TerminalView 翻页锚点反推缓冲起点的绝对日志偏移。
   */
  getOutputBufferBytes(sessionId: string): number {
    return this.outputBuffers.get(sessionId)?.totalBytes ?? 0;
  }

  /** 会话最近输出时间戳（无输出为 0）。 */
  getLastActivityAt(sessionId: string): number {
    return this.lastActivityAt.get(sessionId) ?? 0;
  }

 
  private ensureStatusPolling(): void {
    if (this.statusTimer) return;
    this.statusTimer = setInterval(() => {
      const sessionId = this.activeSessionId;
      if (sessionId) void this.refreshSessionStatus(sessionId);
    }, 2_000);
  }

  private async refreshSessionStatus(sessionId: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === sessionId);
    const cliSessionId = this.cliSessionIds.get(sessionId);
    if (!session || !cliSessionId) return;
    const profile = this.cliProfiles.get(session.profileId);
    if (!profile?.readSessionStatus) return;
    const observed = await profile
      .readSessionStatus(session.cwd, cliSessionId)
      .catch(() => null);
    if (!observed) return;
    const previous = this.sessionStatuses.get(sessionId);
    /* tail 扫描是"最新观测"而非全量状态:字段缺省 = 事件滚出 256KB 窗口或尚未落盘,
       不等于"被清除"——缺省字段保留旧值。真实切换必在 tail 落新事件,
       以非空观测推进,故合并不会挡住正常的模型/思考变更。 */
    const status: CliSessionStatus = {
      model: observed.model ?? previous?.model,
      thinkingLevel: observed.thinkingLevel ?? previous?.thinkingLevel,
    };
    if (
      previous?.model === status.model &&
      previous?.thinkingLevel === status.thinkingLevel
    ) {
      return;
    }
    this.sessionStatuses.set(sessionId, status);
    this.notify();
  }

  setActiveSession(id: string | null): void {
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    this.events.emit(KernelTopics.activeSessionChanged, id);
    if (id) {
      this.ensureStatusPolling();
      void this.refreshSessionStatus(id);
    }
    this.notify();
  }

  async removeSession(id: string): Promise<void> {
    await ipc.sessionKill(id).catch(() => undefined);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    this.cliSessionIds.delete(id);
    this.sessionStatuses.delete(id);
    this.outputBuffers.delete(id);
    this.lastActivityAt.delete(id);
    this.lastActivityNotify.delete(id);
    if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions[0]?.id ?? null;
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
