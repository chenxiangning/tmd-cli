/**
 * 内部拖拽 payload —— 文件树 → composer 的跨插件拖拽通道。
 *
 * 问题:Tauri webview 的 dataTransfer 自定义 mime (application/x-tmd-path)
 * 在某些 webview 实现里被剥离,导致 composer drop 时拿不到。
 *
 * 解法:dragstart 时把 payload 写入 kernel module 级 state;dragend 清除。
 * composer drop 时优先从 state 读,fallback 到 dataTransfer。
 *
 * 使用方:
 * - files 插件:row dragstart 时 setDragPayload({path, isDir, name}) + dragend clearDragPayload()
 * - composer 插件:drop 时 readDragPayload() + 用完 clearDragPayload()
 */

interface InternalDragPayload {
  path: string;
  isDir: boolean;
  name: string;
}

let pending: InternalDragPayload | null = null;

export function setDragPayload(p: InternalDragPayload): void {
  pending = p;
}

export function readDragPayload(): InternalDragPayload | null {
  return pending;
}

export function clearDragPayload(): void {
  pending = null;
}
