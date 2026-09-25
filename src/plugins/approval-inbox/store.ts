/**
 * 审批收件箱 store —— 等待确认会话的聚合快照。
 *
 * 零新检测:数据源 = kernel/askWatch 既有 isWaitingConfirm 状态位(host 主链路
 * 驱动,与侧栏「等待确认」标签同源),本件只做聚合视图:
 * - since 表:askDetected 首见记时;面板后见者时长未知(显示「等待中」);
 * - 摘录缓存:askDetected 边沿拉一次日志尾,剥 ANSI 取末 3 行作提示——不解析
 *   任何 CLI 私有面板结构,原文以会话面板为准;
 * - answer:经 host.writeSession 唯一写入口(写后 8s 抑制窗防残影复燃,行即时消退)。
 * 预设「同意/拒绝」代发键不做:各 CLI 键位语义不一,发错键=批错操作(M2 评审 A2)。
 */
import { createSubscribable } from "@kernel/subscribable";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { stripAnsi } from "@kernel/askWatch";
import { KernelTopics } from "@kernel/events";
import type { PluginEventBus } from "@kernel/plugin";

/** 单条等待行。excerpt = 面板页脚提示(可空:后台会话日志未落盘等)。 */
export interface InboxEntry {
  sessionId: string;
  profileId: string;
  /** 等待开始时刻(本运行内首次观测);null = 面板后见,时长未知。 */
  since: number | null;
  excerpt: string | null;
}

interface InboxState {
  entries: InboxEntry[];
}

const store = createSubscribable<InboxState>({ entries: [] });

/** React 订阅(面板渲染面)。 */
export function useApprovalInbox(): InboxState {
  return store.useStore();
}

/** 非 React 快照读取(测试断言 / 命令侧)。 */
export function approvalInboxSnapshot(): InboxState {
  return store.snapshot;
}

/** since 首见表 + 摘录缓存(会话 id → 时刻 / 摘录文本)。 */
const sinceAt = new Map<string, number>();
const excerpts = new Map<string, string>();

/** 日志尾 → 面板页脚提示:剥 ANSI,取末 3 个非空行,每行截 120 字符。
 *  纯函数;Ask 面板整帧重绘时尾部即页脚内容,提示足够定位「在问什么」。 */
export function excerptFromTail(text: string): string {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .map((line) => line.slice(0, 120))
    .join("\n");
}

/** 全量重算:活会话 × isWaitingConfirm,等待最久者在前;顺带清已消退行的缓存。 */
export function refreshInbox(): void {
  const waiting = host.getSessions().filter((s) => host.isWaitingConfirm(s.id));
  const alive = new Set(waiting.map((s) => s.id));
  for (const id of [...sinceAt.keys()]) if (!alive.has(id)) sinceAt.delete(id);
  for (const id of [...excerpts.keys()]) if (!alive.has(id)) excerpts.delete(id);
  const entries = waiting.map((s) => ({
    sessionId: s.id,
    profileId: s.profileId,
    since: sinceAt.get(s.id) ?? null,
    excerpt: excerpts.get(s.id) ?? null,
  }));
  entries.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
  const prev = store.snapshot.entries;
  const same =
    prev.length === entries.length &&
    prev.every((e, i) => e.sessionId === entries[i].sessionId && e.since === entries[i].since && e.excerpt === entries[i].excerpt);
  if (same) return;
  store.commit({ entries });
}

/** 拉日志尾更新摘录(askDetected 边沿 / 面板首开;失败静默,提示可缺)。 */
async function pullExcerpt(sessionId: string): Promise<void> {
  if (excerpts.has(sessionId)) return;
  try {
    const end = await ipc.sessionLogSize(sessionId);
    if (!end) return; /* 无日志(懒落盘 / 新会话)= 无提示,不报错 */
    const page = await ipc.sessionHistoryPage(sessionId, end, 2048);
    const text = page.text ? excerptFromTail(page.text) : "";
    if (!text) return;
    excerpts.set(sessionId, text);
    refreshInbox();
  } catch {
    /* 摘录是增强,失败静默 */
  }
}

/** askDetected 边沿:记 since(首见才记,重绘不重置)+ 拉摘录 + 重算。 */
export function noteAskDetected(sessionId: string): void {
  if (!sinceAt.has(sessionId)) sinceAt.set(sessionId, Date.now());
  void pullExcerpt(sessionId);
  refreshInbox();
}

/** 面板挂载补盲:已在等待但本运行未见边沿的会话(HMR 重载后)。 */
export function observeCurrentWaitings(): void {
  for (const s of host.getSessions()) {
    if (!host.isWaitingConfirm(s.id)) continue;
    if (!sinceAt.has(s.id)) sinceAt.set(s.id, Date.now());
    void pullExcerpt(s.id);
  }
  refreshInbox();
}

/** 应答:原文追加换行经 host.writeSession 唯一写入口;无论送达与否立即重算。 */
export function answerWaiting(sessionId: string, text: string): Promise<boolean> {
  return host.writeSession(sessionId, text + "\n").finally(refreshInbox);
}

/** boot 接线(activate 调):事件边沿驱动重算。 */
export function bootApprovalInbox(events: PluginEventBus): void {
  events.on<string>(KernelTopics.askDetected, (sessionId) => noteAskDetected(sessionId));
  events.on<unknown>(KernelTopics.turnSettled, () => refreshInbox());
  events.on<unknown>(KernelTopics.sessionsChanged, () => refreshInbox());
  events.on<unknown>(KernelTopics.sessionExited, () => refreshInbox());
}

/** 测试专用:清空模块级状态(vitest 复用同一模块实例)。 */
export function resetApprovalInboxForTest(): void {
  sinceAt.clear();
  excerpts.clear();
  store.commit({ entries: [] });
}
