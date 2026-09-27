/**
 * 审批收件箱 store —— 等待确认会话的聚合快照。
 *
 * 零新检测:数据源 = kernel/askWatch 既有 isWaitingConfirm 状态位(host 主链路
 * 驱动,与侧栏「等待确认」标签同源),本件只做聚合视图:
 * - since 表:askDetected 边沿记时;面板后见者(observeCurrentWaitings)不记,
 *   时长未知显示「等待中」——比从 0 假起走诚实(2026-09-25 评审修订);
 * - 摘录缓存:askDetected 边沿拉一次日志尾,剥 ANSI 取末 3 行作提示——不解析
 *   任何 CLI 私有面板结构,原文以会话面板为准;
 * - 重算驱动:host.subscribe(host.notify 全量旁路,含终端侧作答/静默自愈这类
 *   不发 kernel topic 的清位路径,2026-09-25 评审修订)+ askDetected 边沿;
 *   refreshInbox 内同值短路,重算代价可忽略;
 * - answer:经 host.writeSession 唯一写入口(写后 8s 抑制窗防残影复燃,行即时消退);
 *   失败(死会话/写失败)落 failure 提示位——ask 位在写入前已被同步清除,行会
 *   消退,横幅是唯一的失败反馈面。
 * 预设「同意/拒绝」代发键不做:各 CLI 键位语义不一,发错键=批错操作(M2 评审 A2)。
 */
import { createSubscribable } from "@kernel/subscribable";
import { host } from "@kernel/host";
import { ipc } from "@kernel/ipc";
import { stripAnsi } from "@kernel/askWatch";
import { getTerminalHandle } from "@kernel/terminalHandles";
import { KernelTopics } from "@kernel/events";
import type { PluginEventBus } from "@kernel/plugin";
import { parseAskCard, type AskCard } from "./askCard";

/** 单条等待行。excerpt = 面板页脚提示(可空:后台会话日志未落盘等);
 *  card = omp select 卡结构化解析(问题正文+选项;非 omp 卡为 null)。 */
export interface InboxEntry {
  sessionId: string;
  profileId: string;
  /** 等待开始时刻(本运行内经 askDetected 边沿观测);null = 面板后见,时长未知。 */
  since: number | null;
  excerpt: string | null;
  card: AskCard | null;
}

/** 历史 ask 记录(落盘):行消退/重启后仍可回看「问过什么」。只记提问面,
 *  不记答案(面板无从可靠观测作答内容,不猜)。 */
export interface AskRecord {
  ts: number;
  sessionId: string;
  profileId: string;
  question: string;
  options: string[];
  kind: "select" | "multi";
  multi: number;
}

interface InboxState {
  entries: InboxEntry[];
  /** 最近一次应答写失败的会话 id(行已消退,横幅兜底反馈);成功作答即清。 */
  failure: string | null;
}

const store = createSubscribable<InboxState>({ entries: [], failure: null });

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
const cards = new Map<string, AskCard | null>();

/** ask 历史落盘(localStorage,50 条环):行消退/重启后仍可回看「问过什么」。
 *  指纹 = 问题+选项序;同会话同指纹只记一条,会话退出等待即清指纹(复问重记)。 */
const HISTORY_KEY = "tmd.askHistory.v1";
const HISTORY_MAX = 50;
const historyStore = createSubscribable<{ records: AskRecord[] }>({ records: loadHistory() });
const lastFp = new Map<string, string>();

export function useAskHistory(): { records: AskRecord[] } {
  return historyStore.useStore();
}

/** 非 React 快照读取(测试断言)。 */
export function askHistorySnapshot(): readonly AskRecord[] {
  return historyStore.snapshot.records;
}

function loadHistory(): AskRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? (arr as AskRecord[]).slice(0, HISTORY_MAX) : [];
  } catch {
    return []; /* 历史是增强,坏档回落空 */
  }
}

function pushHistory(sessionId: string, card: AskCard): void {
  const fp = card.question + "\u0001" + card.options.join("\u0001");
  if (lastFp.get(sessionId) === fp) return;
  lastFp.set(sessionId, fp);
  const meta = host.getSessions().find((s) => s.id === sessionId);
  const rec: AskRecord = {
    ts: Date.now(),
    sessionId,
    profileId: meta?.profileId ?? "",
    question: card.question,
    options: card.options,
    kind: card.kind,
    multi: card.multi,
  };
  const next = [rec, ...historyStore.snapshot.records].slice(0, HISTORY_MAX);
  historyStore.commit({ records: next });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota 满:历史可缺,不抛 */
  }
}

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
  for (const id of [...cards.keys()]) if (!alive.has(id)) cards.delete(id);
  /* 退出等待即清指纹:同一问题复问(新一轮 ask)要重新入历史。 */
  for (const id of [...lastFp.keys()]) if (!alive.has(id)) lastFp.delete(id);
  const failure = store.snapshot.failure;
  const nextFailure = failure && alive.has(failure) ? failure : null;
  const entries = waiting.map((s) => ({
    sessionId: s.id,
    profileId: s.profileId,
    since: sinceAt.get(s.id) ?? null,
    excerpt: excerpts.get(s.id) ?? null,
    card: cards.get(s.id) ?? null,
  }));
  entries.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity));
  const prev = store.snapshot.entries;
  const same =
    nextFailure === failure &&
    prev.length === entries.length &&
    prev.every(
      (e, i) =>
        e.sessionId === entries[i].sessionId && e.since === entries[i].since && e.excerpt === entries[i].excerpt && e.card === entries[i].card,
    );
  if (same) return;
  store.commit({ entries, failure: nextFailure });
}

/** 拉日志尾更新摘录与 ask 卡(askDetected 边沿 / 面板首开 / 等待期重同步)。
 *  窗 64KB:omp 卡整帧含边框/衬垫可达数 KB,2KB 旧窗把选项块切在窗外(真机
 *  「看不到选项」根因之一)。摘录与卡每次重拉都跟随尾流刷新(卡态随 tab/光标
 *  演进,一次性缓存是「滞后」根因;静态卡期间末 3 行稳定,摘录不跳)。失败静默。 */
async function pullExcerpt(sessionId: string): Promise<void> {
  try {
    const end = await ipc.sessionLogSize(sessionId);
    if (!end) return; /* 无日志(懒落盘 / 新会话)= 无提示,不报错 */
    const page = await ipc.sessionHistoryPage(sessionId, end, 65536);
    const stripped = page.text ? stripAnsi(page.text) : "";
    if (!stripped) return;
    const text = excerptFromTail(stripped);
    if (text) excerpts.set(sessionId, text);
    const card = parseAskCard(stripped);
    cards.set(sessionId, card);
    if (card) pushHistory(sessionId, card);
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

/** 面板挂载补盲:已在等待但本运行未见边沿的会话(HMR 重载后)。
 *  有意不记 since:真实提问时刻不可知,时长显示「等待中」而非从 0 假起走。 */
export function observeCurrentWaitings(): void {
  for (const s of host.getSessions()) {
    if (!host.isWaitingConfirm(s.id)) continue;
    void pullExcerpt(s.id);
  }
  refreshInbox();
}

/** 应答:原文追加换行经 host.writeSession 唯一写入口(真作答,非 synthetic)。
 *  无论送达与否 ask 位都已被清除(host 侧写入前同步清位),行会即时消退;
 *  写失败时落 failure 提示位(panel 横幅渲染),成功作答清位。 */
export function answerWaiting(sessionId: string, text: string): Promise<boolean> {
  return writeAsAnswer(sessionId, text + "\n", false);
}

/** 卡键位代发:原样写入不追加换行(移动序列/toggle 空格/跳题 ⇥/回车由调用方拼好)。
 *  标 synthetic:键序是面板代操作而非用户作答——不清等待位、不开 8s 写后盲窗
 *  (否则点一次选项面板自盲 8s,卡态跟随全停;真作答/超时由 CLI 侧清位)。 */
export function answerKeys(sessionId: string, keys: string): Promise<boolean> {
  return writeAsAnswer(sessionId, keys, true);
}

function writeAsAnswer(sessionId: string, payload: string, synthetic: boolean): Promise<boolean> {
  return host.writeSession(sessionId, payload, synthetic).then(
    (ok) => {
      store.commit({ entries: store.snapshot.entries, failure: ok ? null : sessionId });
      refreshInbox();
      return ok;
    },
    () => {
      store.commit({ entries: store.snapshot.entries, failure: sessionId });
      refreshInbox();
      return false;
    },
  );
}

/** 用户确认失败横幅(行已消退,无其他出口)。 */
export function dismissFailure(): void {
  if (store.snapshot.failure === null) return;
  store.commit({ entries: store.snapshot.entries, failure: null });
}

/** 直达并聚焦幕布:切激活会话(经 activeSessionChanged→trackOpen 重开被摘
 *  tab)+ 聚焦已挂载幕布(composer 空输入 ↑↓ 焦点移交同款)。幕布未挂载 =
 *  仍切激活静默(TerminalView 挂载后自带输入焦点)。拒绝引导落点:各 CLI
 *  拒绝键不同,收件箱不代发(M2 评审 A2),把人送进幕布自己按。 */
export function gotoAndFocus(sessionId: string): void {
  host.setActiveSession(sessionId);
  getTerminalHandle(sessionId)?.focus();
}

/** boot 接线(activate 调):askDetected 边沿记时/拉摘录;host.subscribe 兜全部
 *  状态位变化(含不发 topic 的终端侧作答与静默自愈)。
 *  等待期 1.5s 重同步:卡态(tab/光标/勾选)只随 PTY 重绘演进,边沿只来一次;
 *  定时重拉日志尾让面板跟随卡态(滞后治理),无等待会话时空转零成本。 */
export function bootApprovalInbox(events: PluginEventBus): () => void {
  const offs = [
    events.on<string>(KernelTopics.askDetected, (sessionId) => noteAskDetected(sessionId)),
    host.subscribe(() => refreshInbox()),
  ];
  const resync = setInterval(() => {
    for (const s of host.getSessions()) {
      if (host.isWaitingConfirm(s.id)) void pullExcerpt(s.id);
    }
  }, 1500);
  /* revoke/回滚熔断时摘订阅,不留幽灵刷新(notify 同款纪律)。 */
  return () => {
    clearInterval(resync);
    for (const off of offs) off();
  };
}

/** 测试专用:清空模块级状态(vitest 复用同一模块实例)。 */
export function resetApprovalInboxForTest(): void {
  sinceAt.clear();
  excerpts.clear();
  cards.clear();
  lastFp.clear();
  historyStore.commit({ records: [] });
  store.commit({ entries: [], failure: null });
}
