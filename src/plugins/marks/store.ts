/**
 * marks 内存单源 + sidecar 持久化 —— 全局标记中心(跨文件聚合)的唯一数据面。
 *
 * 存储(council 裁决):~/.tmd-cli/marks/<dirKey(cwd)>.json,用户项目零污染
 * (checkpoints/assets 同构);通用 fs_* 原语读写,Rust 零改动。
 * 并发契约:不引锁 —— 每次落盘现读-按 id 合并-写回,last-write-wins;
 * JSON 解析守卫,崩溃撕裂写按空清单兜底(标记是低价值可再生数据)。
 * 外部手改不 watch,重开生效(assets 同款语义)。
 */

import { useSyncExternalStore } from "react";
import { ipc } from "@kernel/ipc";
import { getWorkspaces, workspacesReady } from "@kernel/workspace";
import { fingerprintRange, lineHash, markExcerpt, relocateMark, type Mark, type MarkState } from "./anchor";

export interface RevealRequest {
  path: string;
  line: number;
  token: number;
}

interface MarksState {
  loaded: boolean;
  /** cwd(工作区 root)→ 标记清单。 */
  byCwd: Record<string, Mark[]>;
  /** 行间批注卡展开态(纯会话内 UI 态,不落盘)。 */
  expandedIds: readonly string[];
  reveal: RevealRequest | null;
}

const state: MarksState = { loaded: false, byCwd: {}, expandedIds: [], reveal: null };
const listeners = new Set<() => void>();
let snapshot: Readonly<MarksState> = state;
let revealToken = 0;

function emit(): void {
  snapshot = {
    loaded: state.loaded,
    byCwd: { ...state.byCwd },
    expandedIds: [...state.expandedIds],
    reveal: state.reveal,
  };
  listeners.forEach((fn) => fn());
}

/** 非 React 订阅(编辑器扩展用);返回退订。 */
export function subscribeMarks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function marksSnapshot(): Readonly<MarksState> {
  return snapshot;
}

/** React 订阅(整快照;引用稳定由 emit 保证)。 */
export function useMarksState(): Readonly<MarksState> {
  return useSyncExternalStore(subscribeMarks, () => snapshot);
}

let cachedHome = "";
async function marksDir(): Promise<string> {
  if (!cachedHome) cachedHome = `${await ipc.configHomeDir()}/.tmd-cli/marks`;
  return cachedHome;
}

/** 目录名安全的工作区键:fnv 32 位 hex(cwd 判等键,不抗碰撞攻击)。 */
export function dirKey(cwd: string): string {
  return lineHash(cwd);
}

async function sidecarPath(cwd: string): Promise<string> {
  return `${await marksDir()}/${dirKey(cwd)}.json`;
}

function marksOf(cwd: string): Mark[] {
  return (state.byCwd[cwd] ??= []);
}

/** 现读-合并-写回:磁盘条目按 id 并入(内存同 id 优先 = last-write-wins)。
 *  墓碑:removeMark 删除的 id 合并时跳过,否则磁盘旧条目会被并回内存复活(review P1)。 */
const tombstones = new Map<string, Set<string>>();
let dirReady = false;
/* 逐键入标注防抖:review P2 —— persist 每趟 读-合并-写 全量 sidecar,逐键触发放大合并竞态 */
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function persist(cwd: string): Promise<void> {
  try {
    if (!dirReady) {
      /* fsCreateDir 撞已存在即报错 = 幂等(assets 同款);~/.tmd-cli 父目录可能缺,两级都建 */
      const dir = await marksDir();
      await ipc.fsCreateDir(dir.slice(0, dir.lastIndexOf("/"))).catch(() => undefined);
      await ipc.fsCreateDir(dir).catch(() => undefined);
      dirReady = true;
    }
    const path = await sidecarPath(cwd);
    const gone = tombstones.get(cwd);
    const disk = parseSidecar(await ipc.fsReadFile(path).catch(() => "")).filter(
      (mark) => !gone?.has(mark.id),
    );
    const byId = new Map(disk.map((mark) => [mark.id, mark]));
    for (const mark of marksOf(cwd)) byId.set(mark.id, mark);
    state.byCwd[cwd] = [...byId.values()];
    await ipc.fsWriteFile(path, JSON.stringify({ version: 1, marks: state.byCwd[cwd] }));
  } catch {
    /* 落盘失败静默:内存态仍可用,下次变更重试(标记非关键数据)。 */
  }
}

function schedulePersist(cwd: string): void {
  const prev = persistTimers.get(cwd);
  if (prev) clearTimeout(prev);
  persistTimers.set(
    cwd,
    setTimeout(() => {
      persistTimers.delete(cwd);
      void persist(cwd);
    }, 400),
  );
}

function parseSidecar(text: string): Mark[] {
  if (!text.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || !("marks" in parsed)) return [];
    const marks: unknown = parsed.marks;
    /* 旧条目可能缺 excerpt(早期形态):缺省补空串而非整条丢弃 ——
       丢弃会让老标记静默蒸发,补空串只影响引用块摘录为空 */
    return Array.isArray(marks)
      ? marks.filter(isMark).map((m) => {
          const mark = m as Mark;
          return typeof mark.excerpt === "string" ? mark : { ...mark, excerpt: "" };
        })
      : [];
  } catch {
    return [];
  }
}

/** 侧车文件守卫式校验:字段齐且类型对才收,脏数据丢弃。 */
function isMark(value: unknown): boolean {
  const mark = value as Mark;
  return (
    typeof mark?.id === "string" &&
    typeof mark?.path === "string" &&
    typeof mark?.startLine === "number" &&
    typeof mark?.endLine === "number" &&
    mark.startLine >= 1 &&
    mark.endLine >= mark.startLine &&
    typeof mark?.fingerprint?.body === "string" &&
    typeof mark?.fingerprint?.context === "string" &&
    typeof mark?.note === "string" &&
    (mark?.excerpt === undefined || typeof mark?.excerpt === "string") &&
    (mark?.state === "pending" ||
      mark?.state === "staged" ||
      mark?.state === "sent" ||
      mark?.state === "drifted" ||
      mark?.state === "lost") &&
    typeof mark?.createdAt === "number"
  );
}

/** activate 期一次:等工作区就绪后并行加载全部工作区的标记。 */
export async function loadAllMarks(): Promise<void> {
  await workspacesReady.catch(() => undefined);
  const workspaces = getWorkspaces();
  const texts = await Promise.all(
    workspaces.map(async (ws) => {
      const path = await sidecarPath(ws.root).catch(() => "");
      return path ? ipc.fsReadFile(path).catch(() => "") : "";
    }),
  );
  workspaces.forEach((ws, i) => {
    /* 按 id 合并(内存优先):读盘窗口内落锚的内存标记不被磁盘旧像整桶覆写 */
    const disk = parseSidecar(texts[i]);
    const mem = state.byCwd[ws.root] ?? [];
    if (mem.length === 0) state.byCwd[ws.root] = disk;
    else {
      const ids = new Set(mem.map((m) => m.id));
      state.byCwd[ws.root] = [...mem, ...disk.filter((m) => !ids.has(m.id))];
    }
  });
  state.loaded = true;
  emit();
}

export function addMark(input: {
  cwd: string;
  path: string;
  startLine: number;
  endLine: number;
  lines: readonly string[];
  note?: string;
}): Mark {
  const mark: Mark = {
    id: `mk${Date.now().toString(36)}${(++revealToken).toString(36)}`,
    path: input.path,
    startLine: input.startLine,
    endLine: input.endLine,
    fingerprint: fingerprintRange(input.lines, input.startLine, input.endLine),
    excerpt: markExcerpt(input.lines, input.startLine, input.endLine),
    note: input.note ?? "",
    state: "pending",
    createdAt: Date.now(),
  };
  marksOf(input.cwd).push(mark);
  state.expandedIds = [...state.expandedIds, mark.id];
  emit();
  schedulePersist(input.cwd);
  return mark;
}

export function updateNote(cwd: string, id: string, note: string): void {
  const mark = marksOf(cwd).find((m) => m.id === id);
  if (!mark || mark.note === note) return;
  mark.note = note;
  emit();
  schedulePersist(cwd);
}

export function removeMark(cwd: string, id: string): void {
  /* 墓碑:persist 合并磁盘时跳过,否则已删 id 会被旧盘数据并回复活(review P1) */
  (tombstones.get(cwd) ?? tombstones.set(cwd, new Set()).get(cwd)!).add(id);
  state.byCwd[cwd] = marksOf(cwd).filter((m) => m.id !== id);
  state.expandedIds = state.expandedIds.filter((expanded) => expanded !== id);
  emit();
  schedulePersist(cwd);
}

export function setMarkState(cwd: string, id: string, nextState: MarkState): void {
  const mark = marksOf(cwd).find((m) => m.id === id);
  if (!mark || mark.state === nextState) return;
  mark.state = nextState;
  emit();
  schedulePersist(cwd);
}

/** 已入对话(芯片条)标记,发送时注入 wire 并翻 sent。 */
export function stagedMarks(cwd: string): Mark[] {
  return marksOf(cwd).filter((m) => m.state === "staged");
}

export function toggleExpanded(id: string): void {
  state.expandedIds = state.expandedIds.includes(id)
    ? state.expandedIds.filter((expanded) => expanded !== id)
    : [...state.expandedIds, id];
  emit();
}

/** 面板「定位」/ 终端回链共用:请求编辑器扩展滚动+闪烁。 */
export function requestReveal(path: string, line: number): void {
  state.reveal = { path, line, token: ++revealToken };
  emit();
}

/** 编辑器扩展消费:命中当前文件即取走并清空;未命中返回 null。 */
export function takeReveal(path: string): RevealRequest | null {
  const reveal = state.reveal;
  if (!reveal || reveal.path !== path) return null;
  state.reveal = null;
  return reveal;
}

/** 编辑器挂载/文档变更时重定位该文件全部标记(±window 指纹窗口)。 */
export function relocatePath(cwd: string, path: string, lines: readonly string[], window = 3): void {
  let changed = false;
  for (const mark of marksOf(cwd)) {
    if (mark.path !== path || mark.state === "sent" || mark.state === "staged") {
      /* sent 行号冻结(发送的是当时快照);staged 已入对话芯片条,
         翻 drifted/lost 会让芯片静默消失、发送静默丢引用(review P2) */
      continue;
    }
    const result = relocateMark(lines, mark, window);
    if (result.status === "exact") {
      /* 内容回原位(如 undo):lost/drifted 恢复 pending,不失联永久化 */
      if (mark.state === "lost" || mark.state === "drifted") {
        mark.state = "pending";
        changed = true;
      }
      continue;
    }
    mark.startLine = result.startLine;
    mark.endLine = result.endLine;
    mark.state = result.status === "moved" ? "drifted" : "lost";
    changed = true;
  }
  if (changed) {
    emit();
    schedulePersist(cwd);
  }
}
