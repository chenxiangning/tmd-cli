/**
 * 内置终端会话创建与装配 —— 本地默认 shell 的一等 PTY 会话。
 *
 * 与 SSH 同构(见 sshSessions.ts):注册即返回,输出/退出复用
 * `pty://out/{id}` / `pty://exit/{id}` 事件契约,幕布全链路零分叉。
 * 与 CLI 路径(sessionSpawn.ts)的差异:无 profile 身份 —— 不接身份探测、
 * statusWatch 与秒退守望(终端里敲 exit 是正常退出,不是启动失败)。
 */

import { KernelTopics, type EventBus, type SessionStartFailedEvent } from "./events";
import { ipc, type SessionMeta, type SpawnedSession } from "./ipc";
import { adoptPtySession, ADOPT_RACE_REASON } from "./sessionAdopt";
import { getPlatformKind } from "./platform";
import { parseWslUnc, wslShellSpec } from "./wsl";
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
  /** 装配即激活(canonical:指针 + 已读标记 + 广播 + 通知;shell 无后台创建场景)。 */
  setActiveSession(id: string): void;
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
    const unc = parseWslUnc(workspace.root);
    const shell = unc
      ? await wslShellSpec(unc.distro, unc.linuxPath, "wsl-bash")
      : { ...defaultShell(), cwd: workspace.root, kind: "shell" as const };
    const spawned = await ipc
      .sessionSpawn(
        "shell",
        {
          command: shell.command,
          args: shell.args,
          cwd: shell.cwd,
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

  /** spawn 共用装配(订阅/守卫/广播见 kernel/sessionAdopt.ts);守卫命中已广播,抛出上抛。 */
  private async adopt(spawned: SpawnedSession): Promise<SessionMeta> {
    await this.h.refreshSessions();
    const meta = await adoptPtySession(this.h, this.events, spawned.id, { profileId: "shell" });
    if (!meta) throw new Error(ADOPT_RACE_REASON);
    /* 装配即激活:否则 activeId 悬空,welcome 盖在终端上(登录跳转/首点终端都是这个坑)。
       adoptPtySession 只广播事件(tab 条进),指针语义在 host.setActiveSession。 */
    this.h.setActiveSession(meta.id);
    return meta;
  }
}
