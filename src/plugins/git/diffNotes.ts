/**
 * diff 行级批注数据层 —— localStorage 单源(tmd.diffNotes.v2)。
 *
 * 键设计:批注锚 = 文件路径 + 行内容 djb2 哈希(防行号漂移:行内容不变即命中,
 * 行号变了仍能对上);会话分组键 = 批注时刻快照的激活会话 id,无激活会话回落
 * ws:<root>(工作区级)。会话级生存期:LRU 保留 40 个会话,超出剪最旧。
 * UI 响应式经 useDiffNotesStore(useSyncExternalStore)。
 */

import { useSyncExternalStore } from "react";

export interface DiffNote {
  id: string;
  file: string;
  /** djb2(trimmed 行内容)hex,见 lineHash。 */
  lineHash: string;
  /** 批注时刻的行号(新行号优先),仅展示用,锚定靠 lineHash。 */
  lineNo: number;
  /** 批注正文。 */
  text: string;
  /** 批注时刻行内容(回传拼 excerpt 用)。 */
  excerpt: string;
  ts: number;
  sent: boolean;
}

const STORE_KEY = "tmd.diffNotes.v2";
const MAX_SESSIONS = 40;

interface Store {
  /** LRU 序:最旧在前。 */
  order: string[];
  groups: Record<string, DiffNote[]>;
}

function emptyStore(): Store {
  return { order: [], groups: {} };
}

let storage: Pick<Storage, "getItem" | "setItem"> | null = null;
let cache: Store | null = null;
const listeners = new Set<() => void>();
let snapshot: Readonly<Store> = emptyStore();
let idSeq = 0;

/** 测试注入口:传 null 复位为 localStorage;全局无 localStorage 时保持 null,
 * 此时无落盘面、写后 store 即归零(仅测试/嵌入场景可达,生产 Tauri webview 有 localStorage)。 */
export function setNoteStorageForTest(s: Pick<Storage, "getItem" | "setItem"> | null): void {
  storage = s;
  cache = null;
  emit();
}

function backing(): Pick<Storage, "getItem" | "setItem"> | null {
  if (storage) return storage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
}

/* 双窗口同仓并发写:storage 事件失效本窗缓存(last-writer-wins 收敛为
 * 「另一窗写入后本窗重读」,不再各自持陈旧整表互相覆盖)。仅原生 localStorage
 * 生效;测试注入态无跨窗语义。 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORE_KEY && !storage) {
      cache = null;
      emit();
    }
  });
}

function load(): Store {
  if (cache) return cache;
  const raw = backing()?.getItem(STORE_KEY) ?? null;
  let next = emptyStore();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Store>;
      if (Array.isArray(parsed.order) && parsed.groups && typeof parsed.groups === "object") {
        next = { order: parsed.order, groups: parsed.groups };
      }
    } catch {
      /* 撕裂写按空清单兜底(批注是低价值可再生数据) */
    }
  }
  cache = next;
  return next;
}

function emit(): void {
  snapshot = load();
  listeners.forEach((fn) => fn());
}

function save(): void {
  backing()?.setItem(STORE_KEY, JSON.stringify(load()));
  /* cache 置空强制 load() 重新解析出**新对象** —— 否则原地改 cache 后
   * snapshot 引用不变,useSyncExternalStore 判等跳过重渲(写后 UI 冻结)。 */
  cache = null;
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React 订阅:整个 store 快照(引用稳定由 emit 保证)。 */
export function useDiffNotesStore(): Readonly<Store> {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** djb2(首 Horner)32 位 hex;键是trimmed 行内容。 */
export function lineHash(line: string): string {
  const s = line.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) | 0) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** 会话分组键:激活会话快照优先,无会话回落工作区根。 */
export function sessionKeyOf(activeSessionId: string | null, wsRoot: string): string {
  return activeSessionId ?? `ws:${wsRoot}`;
}

/** 会话内取批注(读即 LRU touch)。 */
export function ls(sessionKey: string): readonly DiffNote[] {
  const s = load();
  touch(sessionKey);
  return s.groups[sessionKey] ?? [];
}

function touch(sessionKey: string): void {
  const s = load();
  const i = s.order.indexOf(sessionKey);
  if (i >= 0) s.order.splice(i, 1);
  s.order.push(sessionKey);
}

function prune(): void {
  const s = load();
  while (s.order.length > MAX_SESSIONS) {
    const dropped = s.order.shift();
    if (dropped !== undefined) delete s.groups[dropped];
  }
}

export function add(
  sessionKey: string,
  file: string,
  hash: string,
  lineNo: number,
  text: string,
  excerpt: string,
): DiffNote {
  const note: DiffNote = {
    id: `${Date.now().toString(36)}-${(idSeq++).toString(36)}`,
    file,
    lineHash: hash,
    lineNo,
    text,
    excerpt,
    ts: Date.now(),
    sent: false,
  };
  touch(sessionKey);
  const s = load();
  (s.groups[sessionKey] ??= []).push(note);
  prune();
  save();
  return note;
}

/** 回传标记切换:回传处置位;面板「撤销已回传(重新回传)」复此取消。 */
export function toggleSent(sessionKey: string, noteId: string): void {
  const note = load().groups[sessionKey]?.find((n) => n.id === noteId);
  if (!note) return;
  note.sent = !note.sent;
  save();
}

export function remove(sessionKey: string, noteId: string): void {
  const s = load();
  const list = s.groups[sessionKey];
  if (!list) return;
  const i = list.findIndex((n) => n.id === noteId);
  if (i < 0) return;
  list.splice(i, 1);
  if (list.length === 0) delete s.groups[sessionKey];
  save();
}

/** 行锚键(气泡/揭示共用):文件 + 行哈希。 */
export function noteKey(file: string, hash: string): string {
  return `${file}#${hash}`;
}

/** 揭示桥:列表卡点击 → PatchLines 滚动定位对应 diff 行并闪示(模块级 ref 桥先例)。 */
export const diffNoteRevealRef: { current: ((key: string) => void) | null } = { current: null };
