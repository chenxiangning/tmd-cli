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
  /** CLI 磁盘身份账本读(远程恢复路径的既有会话去重用)。 */
  getCliSessionId(sessionId: string): string | undefined;
  /** CLI 磁盘身份绑定唯一写入口(远程恢复路径的显式绑定,语义同本地 openDiskSession)。 */
  bindIdentity(sessionId: string, cliSessionId: string): boolean;
  /** 活跃指针公开语义(装配即激活;指针+通知+已读+状态轮询,见 host.setActiveSession)。 */
  setActiveSession(id: string): void;
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}

export class SshSessionService {
  /** 已知身份恢复的在途闸:key = engineProfileId:cliSessionId(双击去重,同本地 open)。 */
  private openingResumes = new Map<string, Promise<SessionMeta>>();

  constructor(
    private readonly h: SshSessionHost,
    private readonly events: EventBus,
  ) {}

  /**
   * 创建/重连 SSH 会话。重连形态第一参传旧会话 id:后端取原配置
   * (凭据不出后端)收尾重建,新 id 新 tab,旧 tab 消亡。
   * command 可选 = PTY 内初始命令(远程 WSL 会话用;重连由后端从原会话透传)。
   * engineProfileId 可选 = WSL CLI 会话的引擎档案 id(仅随 command 出现;
   * SessionMeta.engine 透传,composer/Ask 据此取 CLI profile,kind 仍为 ssh)。
   * cliSessionId 可选 = 远程磁盘历史行恢复:已知身份,与本地 openDiskSession
   * 同语义 —— 既有活会话去重聚焦、在途双击闸、spawn 后显式绑定
   * (远程兜底的 createdAt 匹配只对「spawn 后新落盘」有效,resume 旧文件
   * 永远匹配不上,必须显式绑)。
   */
  async create(
    host: SshHostConfig | string,
    workspaceId?: string,
    command?: string,
    engineProfileId?: string,
    cliSessionId?: string,
  ): Promise<SessionMeta> {
    if (!(cliSessionId && engineProfileId)) {
      return this.createUnchecked(host, workspaceId, command, engineProfileId);
    }
    /* 身份去重:该磁盘会话已有活会话 → 聚焦既有,同一会话绝不出两条。 */
    const existing = this.h
      .getSessions()
      .find(
        (s) =>
          s.engine === engineProfileId &&
          this.h.getCliSessionId(s.id) === cliSessionId,
      );
    if (existing) {
      this.h.setActiveSession(existing.id);
      return existing;
    }
    const key = `${engineProfileId}:${cliSessionId}`;
    const opening = this.openingResumes.get(key);
    if (opening) {
      /* 双击复用在途 Promise,完成后补聚焦(否则第二次点击无响应)。 */
      void opening.then((m) => this.h.setActiveSession(m.id)).catch(() => undefined);
      return opening;
    }
    const task = (async () => {
      try {
        return await this.createUnchecked(host, workspaceId, command, engineProfileId, cliSessionId);
      } finally {
        this.openingResumes.delete(key);
      }
    })();
    this.openingResumes.set(key, task);
    return task;
  }

  private async createUnchecked(
    host: SshHostConfig | string,
    workspaceId?: string,
    command?: string,
    engineProfileId?: string,
    cliSessionId?: string,
  ): Promise<SessionMeta> {
    const workspace = getWorkspaces().find((w) => w.id === workspaceId) ?? getActiveWorkspace();
    const spawned =
      typeof host === "string"
        ? await ipc.sshSessionReconnect(host, workspace?.root ?? "", workspace?.id)
        : await ipc.sshSessionCreate(
            host,
            workspace?.root ?? "",
            workspace?.id,
            undefined,
            undefined,
            command,
            engineProfileId,
          );
    /* 装配即激活(与 shell 服务同款坑:否则 activeId 悬空,welcome 盖在终端上,
       且指针已指向新会话时点 tab 会被 setActiveSession 的同值去重早退,永远进不去)。
       adoptPtySession 只广播事件(tab 条进),指针语义在 host.setActiveSession。 */
    const meta = await this.adopt(spawned);
    /* 已知身份显式绑定先于激活:statusRefresh 的远程分派按账本取 cliId 直读远端状态。 */
    if (cliSessionId) this.h.bindIdentity(meta.id, cliSessionId);
    this.h.setActiveSession(meta.id);
    return meta;
  }

  /** spawn/重连共用装配(订阅/守卫/广播见 kernel/sessionAdopt.ts);守卫命中已广播,抛出上抛。 */
  private async adopt(spawned: SpawnedSession): Promise<SessionMeta> {
    await this.h.refreshSessions();
    const meta = await adoptPtySession(this.h, this.events, spawned.id, { profileId: "ssh" });
    if (!meta) throw new Error(ADOPT_RACE_REASON);
    return meta;
  }
}
