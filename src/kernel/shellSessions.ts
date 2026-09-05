/**
 * 内置终端会话创建与装配 —— 本地默认 shell 的一等 PTY 会话。
 *
 * 与 SSH 同构(见 sshSessions.ts):注册即返回,输出/退出复用
 * `pty://out/{id}` / `pty://exit/{id}` 事件契约,幕布全链路零分叉。
 * 与 CLI 路径(sessionSpawn.ts)的差异:无 profile 身份 —— 不接身份探测、
 * statusWatch 与秒退守望(终端里敲 exit 是正常退出,不是启动失败)。
 */

import { KernelTopics, type EventBus, type SessionStartFailedEvent } from "./events";
import { ipc, onPtyExit, onPtyOutput, type SessionMeta, type SpawnedSession } from "./ipc";
import { getPlatformKind } from "./platform";
import { getActiveWorkspace, getWorkspaces } from "./workspace";

/** host 侧最小依赖面(与 SshSessionHost 同形;箭头函数惰性绑定避免构造顺序耦合)。 */
interface ShellSessionHost {
  /** 从 Rust 注册表刷新活会话表。 */
  refreshSessions(): Promise<void>;
  findSession(sessionId: string): SessionMeta | undefined;
  appendOutput(sessionId: string, text: string): void;
  removeSession(sessionId: string): Promise<void>;
  /** 登记输出/退出退订对(会话移除时成对退订)。 */
  trackUnlisten(sessionId: string, offs: Array<() => void>): void;
  /** 活会话表(事件广播载荷)。 */
  getSessions(): SessionMeta[];
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}

/** 平台默认登录 shell:macOS zsh / Linux bash / Windows cmd.exe(未知平台落 zsh,纯浏览器 dev 形态)。 */
function defaultShell(): { command: string; args: string[]; title: string } {
  const kind = getPlatformKind();
  if (kind === "windows") return { command: "cmd.exe", args: [], title: "cmd" };
  if (kind === "linux") return { command: "bash", args: ["-l"], title: "bash" };
  return { command: "zsh", args: ["-l"], title: "zsh" };
}

export class ShellSessionService {
  constructor(
    private readonly h: ShellSessionHost,
    private readonly events: EventBus,
  ) {}

  /**
   * 新建内置终端会话:cwd 取指定/活跃工作区 root。无工作区不 spawn,
   * 广播 sessionStartFailed(复用 StartFailureToast 呈现)后抛出。
   */
  async create(workspaceId?: string): Promise<SessionMeta> {
    const workspace = getWorkspaces().find((w) => w.id === workspaceId) ?? getActiveWorkspace();
    if (!workspace?.root) {
      const reason = "没有活跃工作区,无法确定终端起始目录";
      this.events.emit(KernelTopics.sessionStartFailed, {
        sessionId: null,
        profileId: "shell",
        reason,
      });
      throw new Error(reason);
    }
    const shell = defaultShell();
    const spawned = await ipc
      .sessionSpawn(
        "shell",
        {
          command: shell.command,
          args: shell.args,
          cwd: workspace.root,
          kind: "shell",
          title: shell.title,
        },
        workspace.id,
      )
      .catch((e: unknown) => {
        /* spawn 被拒(命令不存在/IPC 错):幕布不存在,广播原因再抛 */
        const event: SessionStartFailedEvent = {
          sessionId: null,
          profileId: "shell",
          reason: e instanceof Error ? e.message : String(e),
        };
        this.events.emit(KernelTopics.sessionStartFailed, event);
        throw e;
      });
    return this.adopt(spawned);
  }

  /** spawn 共用装配:常驻订阅输出与退出、广播会话表。 */
  private async adopt(spawned: SpawnedSession): Promise<SessionMeta> {
    await this.h.refreshSessions();
    const offOutput = await onPtyOutput(spawned.id, (text) => {
      if (this.h.findSession(spawned.id)) this.h.appendOutput(spawned.id, text);
    });
    const offExit = await onPtyExit(spawned.id, () => {
      void this.h.removeSession(spawned.id);
      this.events.emit(KernelTopics.sessionExited, spawned.id);
    });
    /* removeSession 插进两次订阅 await 之间 → 退订表查不到会漏退订:复查存活,已删则成对退订 */
    if (!this.h.findSession(spawned.id)) {
      [offOutput, offExit].forEach((off) => off());
      return this.h.findSession(spawned.id)!;
    }
    this.h.trackUnlisten(spawned.id, [offOutput, offExit]);
    this.events.emit(KernelTopics.sessionsChanged, this.h.getSessions());
    this.events.emit(KernelTopics.activeSessionChanged, spawned.id);
    this.h.notify();
    return this.h.findSession(spawned.id)!;
  }
}
