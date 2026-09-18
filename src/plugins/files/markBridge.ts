/**
 * md 预览标注桥 —— files 插件内部模块;经内核事件总线与 marks 插件协作,
 * 插件之间零 import(架构铁律 R4 同源纪律:插件互不依赖)。
 *
 * 载荷契约(双端各自声明,字段必须同步):
 * - "file-mark:request"  {path, startLine, endLine}          预览 → marks 落锚
 * - "file-mark:changed"  Record<path, {startLine,endLine}[]>  marks → 预览渲染
 */

import type { PluginEventBus } from "@kernel/plugin";

export interface FileMarkRequest {
  path: string;
  startLine: number;
  endLine: number;
}

export interface FileMarkLite {
  startLine: number;
  endLine: number;
}

export type FileMarkMap = Record<string, FileMarkLite[] | undefined>;

let bus: PluginEventBus | null = null;
let cache: FileMarkMap = {};
const locals = new Set<(marks: FileMarkMap) => void>();

/** files 插件 activate 时注入事件总线,并常驻订阅 changed 馈送缓存。 */
export function setFileMarkBus(next: PluginEventBus): void {
  bus = next;
  bus.on<FileMarkMap>("file-mark:changed", (marks) => {
    cache = marks;
    for (const fn of locals) fn(cache);
  });
}

/** 预览块 ⚑ 点击:请求落锚(marks 侧读文件内容做指纹)。 */
export function requestFileMark(req: FileMarkRequest): void {
  bus?.emit<FileMarkRequest>("file-mark:request", req);
}

/** 预览组件订阅;立即回放当前缓存(激活序竞态免疫)。 */
export function subscribeFileMarks(fn: (marks: FileMarkMap) => void): () => void {
  locals.add(fn);
  fn(cache);
  return () => locals.delete(fn);
}
