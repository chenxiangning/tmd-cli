/**
 * 批次/轮次文件状态 chip 配色(A/M/D → 插入/删除/修改语义色)。
 * 独立模块:BatchRowParts 与 TurnFilesChip 两处同源复用(组件文件禁非组件导出)。
 */

/** 文件状态 → tailwind 语义色 class。 */
export function fileChipCls(st: string): string {
  if (st === "A") return "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)";
  if (st === "D") return "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)";
  return "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)";
}
