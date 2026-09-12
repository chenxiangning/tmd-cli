/**
 * 会话标题 tab 条 store —— 顶栏中央「打开的会话」MRU(容量可配,settings.sessionTabsMax)。
 *
 * 纯事件驱动:所有打开/聚焦路径(spawn、恢复磁盘会话、侧栏点活、删除后隐式切换)
 * 最终都收敛到 KernelTopics.activeSessionChanged 广播,这里订阅即可拿到「打开」事实,
 * host 与全部调用点零改动。设计取舍见 docs/superpowers/specs/2026-09-03-session-title-tabs-design.md:
 * - 打开次序稳定:新会话追加队尾,重复聚焦不重排(防 tab 跳动);超容挤掉最早打开的;
 * - 关闭 = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在);摘活跃 tab 时切到剩余 tab 中
 *   最近打开的一个,摘尽回 welcome(与「回到首页」同语义);
 * - 存活跟随:sessionsChanged 剪除已消失的 id(会话被删 / CLI 进程退出);
 * - 标题快照:打开点击处随手喂入;磁盘真标题落定处(分组 hook/运行区)回喂,
 *   兜「打开早于自动命名落盘」—— tab 标签跟随自动命名,手动命名优先级更高;
 * - 首条用户消息保底(promptSent 事件):磁盘 AI 命名晚于文件出生 35s+(omp 懒落盘
 *   实证),保底标题线上即时可得;磁盘原生标题后到自然覆盖(行链 disk > 保底)。
 * - 不持久化:PTY 会话不跨应用重启存活,持久化只能恢复死 id。
 * - 平铺显示(tile):打开的 tab 全部并排同屏(参照 codeg tile display);
 *   全局开关 localStorage 持久(会话不持久,开关比它活得久),容量挤除/会话消失
 *   时平铺集合随 ids 收敛。
 */

import { createSubscribable } from "./subscribable";
import { host } from "./host";
import { KernelTopics, type EventBus, type PromptSentEvent } from "./events";
import type { SessionMeta } from "./ipc";
import { getSettingsState, subscribeSettings } from "./settings";

/** 容量来源 settings.sessionTabsMax(1-10,默认 4);缩容即时修剪,保留最近打开。 */
subscribeSettings(() => {
  const max = getSettingsState().settings.sessionTabsMax;
  if (state.ids.length > max) commit(state.ids.slice(state.ids.length - max));
});

interface SessionTabsState {
  /** 打开次序(早 → 晚)的活会话 tab id(tmd PTY id,非 CLI 磁盘 id)。 */
  ids: readonly string[];
  /** 平铺显示开关(全局,localStorage 持久):开启且 ids ≥2 时幕布并排全部 tab。 */
  tile: boolean;
}

const TILE_KEY = "tmd.sessionTabs.tile";
const readTile = (): boolean => {
  try {
    return localStorage.getItem(TILE_KEY) === "true";
  } catch {
    return false; // 无 localStorage 环境(Node 测试)退化为关
  }
};

const state: SessionTabsState = { ids: [], tile: readTile() };
const titleHints = new Map<string, string>();
/** 首条用户消息保底标题:key = tmd 会话 id。纯内存,存活剪除同 titleHints。 */
const baselines = new Map<string, string>();
const store = createSubscribable<SessionTabsState>(state);

function emit(): void {
  store.commit({ ids: state.ids, tile: state.tile });
}

function commit(ids: readonly string[]): void {
  state.ids = ids;
  emit();
}

/** 平铺开关(toggle 语义;localStorage 尽力持久,失败静默)。 */
export function toggleSessionTile(): void {
  state.tile = !state.tile;
  try {
    localStorage.setItem(TILE_KEY, String(state.tile));
  } catch {
    /* 无存储环境仅内存态 */
  }
  emit();
}

/** 打开/聚焦 → 进 tab 条:已存在保持原位,新 id 追加并按容量挤除最老。 */
function trackOpen(id: string): void {
  if (state.ids.includes(id)) return;
  const next =
    state.ids.length >= getSettingsState().settings.sessionTabsMax
      ? [...state.ids.slice(state.ids.length - getSettingsState().settings.sessionTabsMax + 1), id]
      : [...state.ids, id];
  commit(next);
}

/** 会话集合变化 → 剪除已消失的 tab 与标题快照(会话被删 / 进程退出)。 */
function pruneTo(sessions: readonly SessionMeta[]): void {
  const live = new Set(sessions.map((s) => s.id));
  for (const map of [titleHints, baselines]) {
    for (const id of [...map.keys()]) {
      if (!live.has(id)) map.delete(id);
    }
  }
  if (state.ids.some((id) => !live.has(id))) {
    commit(state.ids.filter((id) => live.has(id)));
  }
}

/** 关闭语义依赖的 host 指针操作;boot 可注入替身(测试)。 */
interface SessionTabsDeps {
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
  events.on<PromptSentEvent>(KernelTopics.promptSent, (p) => {
    if (p && typeof p.sessionId === "string") captureBaseline(p.sessionId, p.text ?? "");
  });
}

/** 采集保底标题:取首行,斜杠命令(CLI 控制命令,同 omp 命名跳过口径)与空行不采;
 *  已有真快照(打开喂入/磁盘回喂)不覆盖 —— 短码已被 noteSessionTabTitle 拒收,
 *  titleHints 里只可能是真标题,此判据可靠。截 200 与 settingsSanitizeSessions 同口径。 */
function captureBaseline(id: string, text: string): void {
  if (titleHints.has(id)) return;
  const first = (text.split(/\r?\n/)[0] ?? "").replace(/\r$/, "").trim().slice(0, 200);
  if (!first || first.startsWith("/")) return;
  baselines.set(id, first);
  noteSessionTabTitle(id, first);
  /* 行组件不订 tab store:composer 先 writeSession(notify)后 promptSent,重渲已
   * 发生而 baselines 未落 —— 这里补推一次,行标题保底即时上屏。 */
  host.notify();
}

/** 行标题保底读取(活会话行:手动命名 > 磁盘原生标题 > 保底 > 短码)。 */
export function getSessionBaseline(id: string): string | undefined {
  return baselines.get(id);
}

/** 喂标题快照(打开点击处 + 磁盘真标题落定处回喂)。空串忽略,同值幂等;
 *  短码形态(头4…尾4,行点击兜底历史喂入的垃圾)拒收 —— 快照只装真标题。 */
export function noteSessionTabTitle(id: string, title: string): void {
  const trimmed = title.trim();
  if (!trimmed || titleHints.get(id) === trimmed) return;
  if (/^.{4}….{4}$/.test(trimmed)) return;
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

/** 摘掉其余 tab 只留指定 id:不杀会话;活跃 tab 被一并摘掉时指针切到保留 id。
 *  目标不在条内 / 仅剩目标一个时无操作(不动活跃指针)。 */
export function closeOtherSessionTabs(id: string): void {
  if (!state.ids.includes(id) || state.ids.length === 1) return;
  const active = deps.getActiveSessionId();
  const switchActive =
    active !== null && active !== id && state.ids.includes(active);
  commit([id]);
  if (switchActive) deps.setActiveSession(id);
}

/** 摘尽全部 tab:不杀会话;活跃会话在条内时指针置 null 回 welcome。 */
export function closeAllSessionTabs(): void {
  if (state.ids.length === 0) return;
  const active = deps.getActiveSessionId();
  const resetActive = active !== null && state.ids.includes(active);
  commit([]);
  if (resetActive) deps.setActiveSession(null);
}

export function getSessionTabs(): readonly string[] {
  return store.snapshot.ids;
}

/** 平铺开关非 React 读取(渲染期现读/测试断言)。 */
export function getSessionTile(): boolean {
  return store.snapshot.tile;
}

/** React 组件订阅 tab 条变化(useSyncExternalStore,免引入状态库)。
 *  返回快照对象本身(引用随每次 emit 更新):标题快照 noteSessionTabTitle
 *  只改旁表不动 ids 数组,靠快照对象换引用驱动标签重渲染。 */
export function useSessionTabs(): SessionTabsState {
  return store.useStore();
}

/** 测试专用:清空状态与接线(vitest 复用同一模块实例)。 */
export function resetSessionTabsForTest(): void {
  booted = false;
  deps = hostDeps;
  state.tile = false;
  commit([]);
  titleHints.clear();
  baselines.clear();
}
