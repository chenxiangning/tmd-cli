/**
 * 结束 RPC 会话账本 —— 关闭的带渲染会话在左栏「带渲染的会话」分区存续。
 * 缺口:行投影 = tab 生命周期(tab 关即剔行),关 tab(收割)后会话从列表
 * 消失,用户找不到刚关的会话;PTY 侧对照 = 结束会话留注册表/磁盘历史行。
 * 本账本 = 关 tab 瞬间的行快照(profile/cwd/sessionId/title),localStorage
 * 持久化(重启仍在,同 tmd.ss.* 键族),封顶滚动。出口:点行 resume 重开
 * (structuredSessionTabs.openStructuredSessionTab);移除 = 从账本剔除,
 * 会话回落引擎磁盘历史行(RPC 身份徽标仍在)。与 PTY 零共享(R-PTY0):
 * 不接 sessionDeleted/sessionArchive,自有键族。
 * 消费方:structuredSessionTabs(关闭捕获 + 在册判据)、workspace 分区渲染。
 */

import { createSubscribable } from "./subscribable";

/** 一条结束会话记录(未握手即关的空壳不入账 —— 无 resume 出口)。 */
export interface ClosedSsSession {
  profileId: string;
  cwd: string;
  /** 引擎会话 id,即记录主键。 */
  sessionId: string;
  title: string;
  closedAt: number;
  /** 关闭时轮在途(true):resume 重开时种子剪尾(引擎将重放在途轮防重复)。 */
  busy?: boolean;
}

const KEY = "tmd.ss.closed";
const CAP = 50;

function load(): ClosedSsSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is ClosedSsSession =>
        !!r && typeof r === "object" &&
        typeof (r as ClosedSsSession).sessionId === "string" &&
        typeof (r as ClosedSsSession).profileId === "string" &&
        typeof (r as ClosedSsSession).cwd === "string",
    );
  } catch {
    return []; /* 损坏值按空表自愈(下一句写入覆盖落盘) */
  }
}

function save(rows: readonly ClosedSsSession[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* 配额满等写失败:内存态仍有效,下次变更重试 */
  }
}

const store = createSubscribable<readonly ClosedSsSession[]>(load());

/** 记一条结束会话(同 sessionId = 前移置顶刷新;封顶滚动淘汰最旧;closedAt 记账时刻)。 */
export function noteClosedSsSession(row: Omit<ClosedSsSession, "closedAt">): void {
  const rest = store.snapshot.filter((r) => r.sessionId !== row.sessionId);
  store.commit([{ ...row, closedAt: Date.now() }, ...rest].slice(0, CAP));
  save(store.snapshot);
}

/** 显式移除(行上 X):会话不再由分区存续,磁盘历史行回归引擎分组。 */
export function dismissClosedSsSession(sessionId: string): void {
  store.commit(store.snapshot.filter((r) => r.sessionId !== sessionId));
  save(store.snapshot);
}

export function getClosedSsSessions(): readonly ClosedSsSession[] {
  return store.snapshot;
}

/** React 订阅(分区渲染消费)。 */
export function useClosedSsSessions(): readonly ClosedSsSession[] {
  return store.useStore();
}

/** 账本里该会话是否 busy 中关闭(resume 种子剪尾判据;非账本回 false)。 */
export function isClosedSsBusy(sessionId: string): boolean {
  return store.snapshot.some((r) => r.sessionId === sessionId && r.busy === true);
}

/** 账本是否记得该会话 id(工作区磁盘行让位判据之一;活行判据在
 * structuredSessionTabs.isSsSessionTracked 合流)。 */
export function hasClosedSsSession(sessionId: string): boolean {
  return store.snapshot.some((r) => r.sessionId === sessionId);
}
