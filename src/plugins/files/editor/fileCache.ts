/**
 * 文件内容缓存 + 未保存草稿 —— FileTabContent 与编辑器的共享内存层。
 *
 * - fileCache:磁盘内容 LRU(32MB 预算),预览与编辑共读,保存后原地刷新。
 * - drafts:未保存草稿(按绝对路径),切 tab / 关 tab 后保留 —— 复刻 codemoss
 *   fileDocumentSessionCache:关脏 tab 不弹确认,重开 tab 自动恢复草稿。
 * - CRLF:磁盘内容含 \r\n 时,载入编辑器前归一为 \n,保存时还原(codemoss
 *   detectPreservedLineEnding/restore 同思路),避免 CodeMirror 静默改行尾。
 */

import { ipc } from "@kernel/ipc";

export interface FilePayload {
  path: string;
  content: string | null;
  error: string | null;
  loaded: boolean;
}

const FILE_CACHE_BYTE_BUDGET = 32 * 1024 * 1024;
const fileCache = new Map<string, FilePayload>();
let fileCacheBytes = 0;

/** 未保存草稿:路径 → 编辑器文本(\n 归一态)。 */
const drafts = new Map<string, string>();

/** 条目字节估算(UTF-16: length × 2) —— 仅作预算记账,不追求精确。 */
function payloadBytes(p: FilePayload): number {
  return p.content ? p.content.length * 2 : 0;
}

export function cacheGet(path: string): FilePayload | undefined {
  const hit = fileCache.get(path);
  if (hit) {
    /* LRU:命中即提新(delete + set 把条目移到最新位) */
    fileCache.delete(path);
    fileCache.set(path, hit);
  }
  return hit;
}

export function cacheSet(path: string, payload: FilePayload): void {
  const prev = fileCache.get(path);
  if (prev) fileCacheBytes -= payloadBytes(prev);
  fileCache.delete(path);
  fileCache.set(path, payload);
  fileCacheBytes += payloadBytes(payload);
  /* 超预算淘汰最旧;刚写入的这条永远保留(单文件超预算也容忍) */
  let oldest = fileCache.keys().next();
  while (fileCacheBytes > FILE_CACHE_BYTE_BUDGET && !oldest.done && oldest.value !== path) {
    fileCacheBytes -= payloadBytes(fileCache.get(oldest.value)!);
    fileCache.delete(oldest.value);
    oldest = fileCache.keys().next();
  }
}

/** 拉取文件内容(带缓存);加载完成由调用方轮询 cacheGet(path).loaded 感知。 */
export function loadFile(path: string): FilePayload {
  const cached = cacheGet(path);
  if (cached) return cached;
  const fresh: FilePayload = { path, content: null, error: null, loaded: false };
  cacheSet(path, fresh);
  ipc.fsReadFile(path).then(
    (content) => {
      /* 条目可能已被 LRU 淘汰:直接重插结果(幂等,不复活半状态) */
      cacheSet(path, { path, content, error: null, loaded: true });
    },
    (e) => {
      cacheSet(path, { path, content: null, error: String(e), loaded: true });
    },
  );
  return fresh;
}

/** 保存成功后原地刷新缓存内容(磁盘真实形态),预览/重开编辑器读到新值。 */
export function cacheRefreshContent(path: string, content: string): void {
  cacheSet(path, { path, content, error: null, loaded: true });
}

/* ── 草稿 ── */

export function draftGet(path: string): string | undefined {
  return drafts.get(path);
}

export function draftSet(path: string, content: string): void {
  drafts.set(path, content);
}

export function draftDelete(path: string): void {
  drafts.delete(path);
}

/** 路径等于 prefix 或在其下(子孙);`/` 与 `\` 都认 —— Windows 路径来自 Rust。 */
export function pathEqualsOrUnder(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}\\`)
  );
}

/** 路径或其子孙(目录整体)的草稿作废 —— 目录被重命名/删除时调用。 */
export function draftDeletePrefix(prefix: string): void {
  for (const key of drafts.keys()) {
    if (pathEqualsOrUnder(key, prefix)) drafts.delete(key);
  }
}

/** 重命名迁移:把旧路径(或其子孙)的草稿键搬到新路径(或其子孙)。 */
export function draftRenamePrefix(oldPrefix: string, newPrefix: string): void {
  const moved: Array<[string, string]> = [];
  for (const [key, value] of drafts) {
    if (!pathEqualsOrUnder(key, oldPrefix)) continue;
    const mapped =
      key === oldPrefix
        ? newPrefix
        : `${newPrefix}${key.slice(oldPrefix.length)}`;
    moved.push([mapped, value]);
  }
  if (moved.length === 0) return;
  for (const key of [...drafts.keys()]) {
    if (pathEqualsOrUnder(key, oldPrefix)) drafts.delete(key);
  }
  for (const [mapped, value] of moved) drafts.set(mapped, value);
}

/** 缓存条目整段作废(路径或其子孙)—— 目录被删除/重命名时调用。 */
export function cacheDeletePrefix(prefix: string): void {
  for (const key of [...fileCache.keys()]) {
    if (pathEqualsOrUnder(key, prefix)) fileCache.delete(key);
  }
}

/* ── 行尾保持 ── */

/** 磁盘内容 → 编辑器内容:\r\n 归一为 \n。返回编辑器态文本。 */
export function toEditorContent(disk: string): { text: string; hasCRLF: boolean } {
  const hasCRLF = disk.includes("\r\n");
  return { text: hasCRLF ? disk.replace(/\r\n/g, "\n") : disk, hasCRLF };
}

/** 编辑器内容 → 磁盘内容:原始文件是 CRLF 时还原行尾。 */
export function toDiskContent(text: string, hasCRLF: boolean): string {
  return hasCRLF ? text.replace(/\n/g, "\r\n") : text;
}
