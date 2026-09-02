/**
 * 树形构造 —— 平铺文件列表 → 一级目录分组(保持浅嵌套,不递归)。
 * 目录头按名称排序;根级文件排在目录组之前。
 * 注意:分组后行的 file.path 被截为目录内相对名(展示用),
 * 勾选/stage 操作仍须用完整路径 —— 由 fullPath 字段保留。
 */

import type { GitFileStatus } from "@kernel/ipc";

export type FileRow = { depth: number; file: GitFileStatus } | { dir: string };

export function buildTree(files: GitFileStatus[]): FileRow[] {
  const byDir = new Map<string, GitFileStatus[]>();
  const roots: GitFileStatus[] = [];
  for (const f of files) {
    const idx = f.path.indexOf("/");
    if (idx < 0) {
      roots.push(f);
    } else {
      const dir = f.path.slice(0, idx);
      const list = byDir.get(dir) ?? [];
      list.push(f);
      byDir.set(dir, list);
    }
  }
  const rows: FileRow[] = roots.map((f) => ({ depth: 0, file: f }));
  for (const [dir, list] of [...byDir.entries()].sort()) {
    rows.push({ dir });
    for (const f of list) rows.push({ depth: 1, file: f });
  }
  return rows;
}
