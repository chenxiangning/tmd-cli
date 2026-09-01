/**
 * 宿主 —— 插件注册表 + 挂载点注册表 + 会话服务的装配点。
 *
 * 内核不 import 任何插件；插件清单在 src/plugins/index.ts，
 * main.tsx 启动时一次性注册激活。
 */

import { useSyncExternalStore } from "react";
import { EventBus, KernelTopics } from "./events";

import { ipc, onPtyExit, onPtyOutput, type SessionMeta, type SpawnSpec } from "./ipc";
import type { CliProfile } from "./cli";
import type { MountContribution, MountPoint, Plugin, PluginContext } from "./plugin";

class Host implements PluginContext {
  readonly events = new EventBus();

  private plugins = new Map<string, Plugin>();
  private cliProfiles = new Map<string, CliProfile>();
  private mounts = new Map<MountPoint, MountContribution[]>();
  private sessions: SessionMeta[] = [];
  private activeSessionId: string | null = null;
  private listeners = new Set<() => void>();
  /** 每会话 PTY 输出环形缓冲：会话切换后 xterm 重挂载靠它回放，这是"切回不黑屏"的核心。 */
  private outputBuffers = new Map<string, string>();
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

  // ---- 插件生命周期 -------------------------------------------------------

  /** 并发闸：StrictMode 双调用会在首个 await 处交错，已激活过滤挡不住，必须共享同一个激活 Promise。 */
  private activation: Promise<void> | null = null;

  activateAll(plugins: Plugin[]): Promise<void> {
    if (!this.activation) {
      this.activation = this.doActivateAll(plugins);
      // 同步拉一次历史会话(从 Rust 持久化目录),让前端恢复显示。
      void this.restoreSessions();
    }
    return this.activation;
  }

  /** 从 Rust 端拉历史 sessions;不再重新 spawn PTY(用户点开才重连)。 */
  private async restoreSessions(): Promise<void> {
    try {
      const list = await ipc.sessionList();
      this.sessions = list;
      this.notify();
    } catch {
      // 非 Tauri 环境(浏览器)静默,保持空表
    }
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
        const spawned = await ipc.sessionSpawn(profileId, spec, workspaceId);
    this.sessions = await ipc.sessionList();
    this.activeSessionId = spawned.id;
    // 常驻订阅：从会话诞生起就持续缓冲输出，与幕布是否挂载无关。
    void onPtyOutput(spawned.id, (text) => this.appendOutput(spawned.id, text));
    onPtyExit(spawned.id, () => {
      void this.removeSession(spawned.id);
      this.events.emit(KernelTopics.sessionExited, spawned.id);
    });
    this.events.emit(KernelTopics.sessionsChanged, this.sessions);
    this.events.emit(KernelTopics.activeSessionChanged, spawned.id);
    this.notify();
    return this.sessions.find((s) => s.id === spawned.id)!;
  }
  /** 单会话输出缓冲上限。全屏 TUI 靠重绘恢复，保留尾部足够。 */
  private static readonly OUTPUT_BUFFER_LIMIT = 500_000;

  private appendOutput(sessionId: string, text: string): void {
    const prev = this.outputBuffers.get(sessionId) ?? "";
    let next = prev + text;
    if (next.length > Host.OUTPUT_BUFFER_LIMIT) {
      next = next.slice(next.length - Host.OUTPUT_BUFFER_LIMIT);
    }
    this.outputBuffers.set(sessionId, next);
    this.events.emit(ptyLiveTopic(sessionId), text);

    const now = Date.now();
    this.lastActivityAt.set(sessionId, now);
    // 呼吸灯节流：每会话 500ms 最多触发一次外壳重渲染
    if (now - (this.lastActivityNotify.get(sessionId) ?? 0) > 500) {
      this.lastActivityNotify.set(sessionId, now);
      this.notify();
    }
  }

  /** 会话至今的全部（尾部）输出，供 xterm 重挂载回放。 */
  getOutputBuffer(sessionId: string): string {
    return this.outputBuffers.get(sessionId) ?? "";
  }

  /** 会话最近输出时间戳（无输出为 0）。 */
  getLastActivityAt(sessionId: string): number {
    return this.lastActivityAt.get(sessionId) ?? 0;
  }

  setActiveSession(id: string | null): void {
    if (this.activeSessionId === id) return;
    this.activeSessionId = id;
    this.events.emit(KernelTopics.activeSessionChanged, id);
    this.notify();
  }

  async removeSession(id: string): Promise<void> {
    await ipc.sessionKill(id).catch(() => undefined);
    this.sessions = this.sessions.filter((s) => s.id !== id);
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
