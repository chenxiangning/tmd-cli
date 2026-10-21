/**
 * 批次/轮次文件状态 chip 配色(A/M/D → 插入/删除/修改语义色)。
 * 独立模块:BatchRowParts 与 TurnFilesChip 两处同源复用(组件文件禁非组件导出)。
 * 字母→语义判定消费 kernel/gitStatusColor 唯一源(批三收敛);chip 底+字
 * 双 class 是审批线表面语义。
 */
import { gitStatusSemantic, type GitStatusSemantic } from "@kernel/gitStatusColor";

/** 语义 → chip 底+字 class(审批线 token)。 */
const SEMANTIC_CHIP_CLS: Record<GitStatusSemantic, string> = {
  added: "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)",
  deleted: "bg-(--tmd-diff-removed)/15 text-(--tmd-diff-removed)",
  modified: "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)",
  renamed: "bg-(--tmd-accent)/15 text-(--tmd-accent)",
  untracked: "bg-(--tmd-bg-hover) text-(--tmd-fg-muted)",
};

/** 文件状态 → tailwind 语义色 class。checkpoints 域 "C" = 冲突(capture.rs
 *  dirty_paths 冲突路径标 C),非 git 拷贝语义,特判归 modified 警示色。 */
export function fileChipCls(st: string): string {
  return SEMANTIC_CHIP_CLS[st === "C" ? "modified" : gitStatusSemantic(st)];
}
