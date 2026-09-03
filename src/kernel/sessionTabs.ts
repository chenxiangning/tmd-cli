/**
 * 会话标题 tab 条 store —— 顶栏中央「打开的会话」MRU(容量 4)。
 *
 * 纯事件驱动:所有打开/聚焦路径(spawn、恢复磁盘会话、侧栏点活、删除后隐式切换)
 * 最终都收敛到 KernelTopics.activeSessionChanged 广播,这里订阅即可拿到「打开」事实,
 * host 与全部调用点零改动。设计取舍见 docs/superpowers/specs/2026-09-03-session-title-tabs-design.md:
 * - 打开次序稳定:新会话追加队尾,重复聚焦不重排(防 tab 跳动);超容挤掉最早打开的;
 * - 关闭 = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在);摘活跃 tab 时切到剩余 tab 中
 *   最近打开的一个,摘尽回 welcome(与「回到首页」同语义);
 * - 存活跟随:sessionsChanged 剪除已消失的 id(会话被删 / CLI 进程退出);
 * - 标题快照:打开点击处本就持有解析好的标题,noteSessionTabTitle 随手喂入兜底;
 *   渲染优先级:手动命名(settings.sessionTitles)> 快照 > 短码,改名即时生效。
 * - 不持久化:PTY 会话不跨应用重启存活,持久化只能恢复死 id。
 */

import { useSyncExternalStore } from "react";
import { host } from "./host";
import { KernelTopics, type EventBus } from "./events";
import type { SessionMeta } from "./ipc";

/** tab 条容量:同时展示的打开会话数上限(用户定向:4 个)。 */
export const SESSION_TABS_MAX = 4;

export interface SessionTabsState {
  /** 打开次序(早 → 晚)的活会话 tab id(tmd PTY id,非 CLI 磁盘 id)。 */
  ids: readonly string[];
}

const state: SessionTabsState = { ids: [] };
/** 标题快照:key = tmd 会话 id。仅兜底展示,跟随存活剪除,不持久化。 */
const titleHints = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: SessionTabsState = state;

function emit(): void {
  snapshot = { ids: state.ids };
  listeners.forEach((fn) => fn());
}

function commit(ids: readonly string[]): void {
  state.ids = ids;
  emit();
}

/** 打开/聚焦 → 进 tab 条:已存在保持原位,新 id 追加并按容量挤除最老。 */
function trackOpen(id: string): void {
  if (state.ids.includes(id)) return;
  const next =
    state.ids.length >= SESSION_TABS_MAX
      ? [...state.ids.slice(state.ids.length - SESSION_TABS_MAX + 1), id]
      : [...state.ids, id];
  commit(next);
}

/** 会话集合变化 → 剪除已消失的 tab 与标题快照(会话被删 / 进程退出)。 */
function pruneTo(sessions: readonly SessionMeta[]): void {
  const live = new Set(sessions.map((s) => s.id));
  for (const id of [...titleHints.keys()]) {
    if (!live.has(id)) titleHints.delete(id);
  }
  if (state.ids.some((id) => !live.has(id))) {
    commit(state.ids.filter((id) => live.has(id)));
  }
}

/** 关闭语义依赖的 host 指针操作;boot 可注入替身(测试)。 */
export interface SessionTabsDeps {
  getActiveSessionId(): string | null;
  setActiveSession(id: string | null): void;
}

const hostDeps: SessionTabsDeps = {
  getActiveSessionId: () => host.getActiveSessionId(),
  setActiveSession: (id) => host.setActiveSession(id),
};
let deps: SessionTabsDeps = hostDeps;

let booted = false;
/** 启动时接线(main.tsx);幂等。deps 仅供测试注入。 */
export function bootSessionTabs(events: EventBus, injected?: SessionTabsDeps): void {
  if (booted) return;
  booted = true;
  if (injected) deps = injected;
  events.on<unknown>(KernelTopics.activeSessionChanged, (payload) => {
    if (typeof payload === "string" && payload) trackOpen(payload);
  });
  events.on<SessionMeta[]>(KernelTopics.sessionsChanged, (sessions) =>
    pruneTo(sessions ?? []),
  );
}

/** 打开点击处随手喂标题快照(渲染优先级:手动命名 > 快照 > 短码)。空串忽略。 */
export function noteSessionTabTitle(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed || titleHints.get(id) === trimmed) return;
  titleHints.set(id, trimmed);
  emit();
}

/** 非 React 读取标题快照(tab 组件渲染期取值)。 */
export function getSessionTabTitle(id: string): string | undefined {
  return titleHints.get(id);
}

/** 摘 tab:不杀会话;摘的是活跃 tab 时切到剩余最近打开的一个,摘尽回 welcome。 */
export function closeSessionTab(id: string): void {
  if (!state.ids.includes(id)) return;
  const rest = state.ids.filter((x) => x !== id);
  commit(rest);
  if (deps.getActiveSessionId() === id) {
    deps.setActiveSession(rest[rest.length - 1] ?? null);
  }
}

export function getSessionTabs(): readonly string[] {
  return snapshot.ids;
}

/** React 组件订阅 tab 条变化(useSyncExternalStore,免引入状态库)。
 *  返回快照对象本身(引用随每次 emit 更新):标题快照 noteSessionTabTitle
 *  只改旁表不动 ids 数组,靠快照对象换引用驱动标签重渲染。 */
export function useSessionTabs(): SessionTabsState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

/** 测试专用:清空状态与接线(vitest 复用同一模块实例)。 */
export function resetSessionTabsForTest(): void {
  booted = false;
  deps = hostDeps;
  commit([]);
  titleHints.clear();
}
