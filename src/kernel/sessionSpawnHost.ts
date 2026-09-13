/**
 * SessionSpawnService 的 host 侧最小依赖面,自 sessionSpawn.ts 迁出
 * (单文件 ≤300 行铁则)。实现体在 host,箭头函数惰性绑定,避免构造顺序耦合。
 */

import type { SessionMeta } from "./ipc";
import type { CliProfile } from "./cli";

/** host 侧最小依赖面(箭头函数惰性绑定,避免整 host 的构造顺序耦合)。 */
export interface SessionSpawnHost {
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
  /** 预灌输出缓冲(接管转正;只进存储不进守望主链,hostWatches.seedOutputBuffer)。 */
  seedOutputBuffer(sessionId: string, text: string): void;
  /** 会话移除(exit 回调清场;host.removeSession 主链路)。 */
  removeSession(sessionId: string): Promise<void>;
  /** 外壳重渲染通知(Host.notify)。 */
  notify(): void;
}
