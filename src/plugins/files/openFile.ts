/**
 * 打开文件 tab 的统一入口 —— 树点击、新建完成、重命名迁移共用。
 * 原 index.tsx 内联函数,编辑/右键菜单功能引入后多文件需要,拆出防循环依赖。
 *
 * openFileAtLine 另带「打开并定位行」通道(搜索面板命中跳转用):
 * 模块级一次性消费(marks store 的 take 语义同款)—— payload.line 只是随
 * tab 携带的记录,真正驱动编辑器定位的是 takeFileRevealLine。
 */

import { openTab } from "@kernel/tabs";
import { baseName } from "@kernel/pathUtils";

export function openFileInTab(path: string): void {
  openTab({
    id: `file:${path}`,
    kind: "file",
    title: baseName(path) || path,
    path,
    payload: { path },
  });
}

/** 待定位行(绝对路径 → 行号):写入方 openFileAtLine,消费方 FileTabContent。 */
const fileRevealLines = new Map<string, number>();

/** 打开文件并定位到某行(1 基)。已开 tab 用 refresh 刷新 payload(深链重开语义)。 */
export function openFileAtLine(path: string, line: number): void {
  fileRevealLines.set(path, line);
  openTab(
    {
      id: `file:${path}`,
      kind: "file",
      title: baseName(path) || path,
      path,
      payload: { path, line },
    },
    { refresh: true },
  );
}

/** 一次性消费该文件的定位行;无待定位返回 null。 */
export function takeFileRevealLine(path: string): number | null {
  const line = fileRevealLines.get(path);
  if (line === undefined) return null;
  fileRevealLines.delete(path);
  return line;
}
