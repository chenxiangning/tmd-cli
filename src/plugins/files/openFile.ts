/**
 * 打开文件 tab 的统一入口 —— 树点击、新建完成、重命名迁移共用。
 * 原 index.tsx 内联函数,编辑/右键菜单功能引入后多文件需要,拆出防循环依赖。
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
