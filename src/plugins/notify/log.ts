/**
 * 通知中心流水 ── 全量历史旁挂存储(单文件,notify-log.json,仿 wiki store)。
 *
 * 语义:流水 = 全量历史,窗口聚焦/免打扰也记(闸只作用于 OS 通知与提示音);
 * 追加时顺带过滤过期(notifyLogDays,默认 7 天)+ 500 条上限剪最旧;
 * 坏文件/version 不符 → 空文档不抛;非缺失读错误放弃本条不覆写(wiki 同纪律)。
 * 纯函数(解析/追加/剪枝/分组)与持久化队列分离,纯函数单测覆盖。
 */

import { ipc } from "@kernel/ipc";
import { createSubscribable } from "@kernel/subscribable";

/** 流水条目类别:ask 等待 / turn 轮次结束 / exit 会话退出 / quota 额度预警。 */
export type NotifyLogKind = "ask" | "turn" | "exit" | "quota";

/** 单条流水(OS 通知的标题/正文快照,会话已退出后仍可读)。 */
export interface NotifyEntry {
  id: string;
  ts: number;
  kind: NotifyLogKind;
  sessionId: string;
  profileId?: string;
  title: string;
  snippet?: string;
}

/** 磁盘文档形态;version 不符按空文档处理(不迁移)。 */
export interface NotifyDoc {
  version: 1;
  entries: NotifyEntry[];
}

/** 条数上限兜底(过期过滤之外的第二道体积闸)。 */
export const ENTRIES_MAX = 500;

/** 生成短随机 id(wiki 同款;碰撞面 = 同毫秒同随机段,可忽略)。 */
function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 条目最小形状守卫:手改丢字段/类别拼坏的条目直接弃。 */
function entryOk(e: unknown): e is NotifyEntry {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id !== "" &&
    typeof o.ts === "number" &&
    Number.isFinite(o.ts) &&
    (o.kind === "ask" || o.kind === "turn" || o.kind === "exit" || o.kind === "quota") &&
    typeof o.sessionId === "string" &&
    typeof o.title === "string" &&
    (o.snippet === undefined || typeof o.snippet === "string")
  );
}

/** 解析磁盘文本;坏 JSON / version≠1 / 条目形状不合法 → 丢弃或空文档,绝不抛。 */
export function parseNotifyLog(text: string): NotifyDoc {
  try {
    const raw = JSON.parse(text) as { version?: unknown; entries?: unknown };
    if (raw?.version !== 1 || !Array.isArray(raw.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: raw.entries.filter(entryOk) };
  } catch {
    return { version: 1, entries: [] };
  }
}

/** 追加 + 双闸剪枝:过滤 ts < now - maxDays 的过期条目,超上限从最旧剪。 */
export function appendEntry(
  doc: NotifyDoc,
  entry: Omit<NotifyEntry, "id">,
  now: number,
  maxDays: number,
): NotifyDoc {
  const cutoff = now - maxDays * 86_400_000;
  const entries = [...doc.entries, { ...entry, id: newId() }].filter((e) => e.ts >= cutoff);
  return { version: 1, entries: entries.slice(Math.max(0, entries.length - ENTRIES_MAX)) };
}

/** 面板分组纯函数:今日(与 now 同一本地日历日)/ 更早;组内最新在前。 */
export function groupNotifyEntries(
  entries: readonly NotifyEntry[],
  now: Date,
): { today: NotifyEntry[]; earlier: NotifyEntry[] } {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today: NotifyEntry[] = [];
  const earlier: NotifyEntry[] = [];
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    (e.ts >= dayStart ? today : earlier).push(e);
  }
  return { today, earlier };
}

/** 读失败是否为「文件不存在」形态(Rust 包装的 io 错误文本,wiki 同款判定)。 */
function isMissingReadErr(msg: string): boolean {
  return /os error [23]\b|no such file/i.test(msg);
}

/* ── 持久化(互斥队列 + 内存快照 store,面板订阅面) ─────────────────── */

const EMPTY: NotifyDoc = { version: 1, entries: [] };
const store = createSubscribable<readonly NotifyEntry[]>(EMPTY.entries);

/** React 订阅(面板渲染面)。 */
export function useNotifyLog(): readonly NotifyEntry[] {
  return store.useStore();
}

let dirOnce: string | null = null;
async function logFilePath(): Promise<string> {
  dirOnce ??= await ipc.configDir();
  return `${dirOnce}/notify-log.json`;
}

let queue: Promise<void> = Promise.resolve();

/** 面板/追加共用的互斥窗:任务内先读后写,队列保证无交叉 RMW。 */
function withLogLock(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

/** 启动装载(activate 调一次):读盘 → 内存快照;失败按空流水,面板仍可用。 */
export function bootNotifyLog(): void {
  void withLogLock(async () => {
    try {
      const text = await ipc.fsReadFile(await logFilePath());
      store.commit(parseNotifyLog(text).entries);
    } catch (e) {
      if (!isMissingReadErr(String(e))) console.warn("[notify] 读通知流水失败,按空流水", e);
      store.commit(EMPTY.entries);
    }
  });
}

/** 追加一条流水(异步落盘;写失败静默,内存快照即时反映)。ts 由本口盖章。 */
export function recordNotifyEntry(entry: Omit<NotifyEntry, "id" | "ts">, maxDays: number): void {
  void withLogLock(async () => {
    const path = await logFilePath();
    let text = "";
    try {
      text = await ipc.fsReadFile(path);
    } catch (e) {
      if (!isMissingReadErr(String(e))) {
        /* 读失败 ≠ 空库:环境抖动时落笔会把整个流水清空,放弃本条。 */
        console.warn("[notify] 读通知流水失败,放弃本条", e);
        return;
      }
    }
    const next = appendEntry(text ? parseNotifyLog(text) : EMPTY, { ...entry, ts: Date.now() }, Date.now(), maxDays);
    try {
      await ipc.fsWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
    } catch {
      return; /* 写失败静默:内存快照已含本条,下次追加会重写全量。 */
    }
    store.commit(next.entries);
  });
}

/** 清空流水(面板「清空」二步确认后调用):空文档落盘 + 快照即清。 */
export function clearNotifyLog(): void {
  void withLogLock(async () => {
    try {
      await ipc.fsWriteFile(await logFilePath(), `${JSON.stringify(EMPTY, null, 2)}\n`);
    } catch {
      return;
    }
    store.commit(EMPTY.entries);
  });
}
