/**
 * SSH 会话创建与装配 —— 从 host.ts 拆出(单文件 ≤300 行铁则)。
 *
 * SSH 一等会话与本地 PTY 同构:注册即返回,连接/认证由 Rust 后台完成;
 * 输出/退出复用 `pty://out/{id}` / `pty://exit/{id}` 事件契约,
 * 幕布与活动守望对会话后端类型零感知。
 */

import type { EventBus } from "./events";
import { ipc, type SessionMeta, type SpawnedSession } from "./ipc";
import { adoptPtySession, ADOPT_RACE_REASON } from "./sessionAdopt";
import type { SshHostConfig } from "./sshTypes";
import { getActiveWorkspace, getWorkspaces } from "./workspace";

/** host 侧最小依赖面(箭头函数惰性绑定,避免整 host 的构造顺序耦合)。 */
interface SshSessionHost {
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

export class SshSessionService {
  constructor(
    private readonly h: SshSessionHost,
    private readonly events: EventBus,
  ) {}

  /**
   * 创建/重连 SSH 会话。重连形态第一参传旧会话 id:后端取原配置
   * (凭据不出后端)收尾重建,新 id 新 tab,旧 tab 消亡。
   */
  async create(host: SshHostConfig | string, workspaceId?: string): Promise<SessionMeta> {
    const workspace = getWorkspaces().find((w) => w.id === workspaceId) ?? getActiveWorkspace();
    const spawned =
      typeof host === "string"
        ? await ipc.sshSessionReconnect(host, workspace?.root ?? "", workspace?.id)
        : await ipc.sshSessionCreate(host, workspace?.root ?? "", workspace?.id);
    return this.adopt(spawned);
  }

  /** spawn/重连共用装配(订阅/守卫/广播见 kernel/sessionAdopt.ts);守卫命中已广播,抛出上抛。 */
  private async adopt(spawned: SpawnedSession): Promise<SessionMeta> {
    await this.h.refreshSessions();
    const meta = await adoptPtySession(this.h, this.events, spawned.id, { profileId: "ssh" });
    if (!meta) throw new Error(ADOPT_RACE_REASON);
    return meta;
  }
}
