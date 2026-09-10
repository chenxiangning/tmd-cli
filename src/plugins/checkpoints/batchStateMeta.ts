/**
 * 批状态元表 —— 批头(状态点/徽标配色)与批尾(动作条件/说明文案)共用
 * (自 BatchRow.tsx 随批头拆件迁出,非组件模块)。
 */

import type { CkptBatch } from "@kernel/ipc";

/* 状态色走主题 token(随 preset 联动);紫 = 回退语义色(无 token,钉死 #a78bfa) */
export const STATE_META = {
  open: {
    label: "进行中",
    dot: "var(--tmd-accent)",
    chip: "bg-(--tmd-accent-soft) text-(--tmd-accent)",
  },
  pending: {
    label: "待审",
    dot: "var(--tmd-git-modified)",
    chip: "bg-(--tmd-git-modified)/15 text-(--tmd-git-modified)",
  },
  approved: { label: "已通过", dot: "var(--tmd-diff-inserted)", chip: "bg-(--tmd-diff-inserted)/15 text-(--tmd-diff-inserted)" },
  reverted: { label: "已退", dot: "#a78bfa", chip: "bg-[#a78bfa]/15 text-[#a78bfa]" },
  done: {
    label: "已处理",
    dot: "var(--tmd-fg-subtle)",
    chip: "bg-(--tmd-fg-subtle)/15 text-(--tmd-fg-subtle)",
  },
} as const;

export type BatchStateKey = keyof typeof STATE_META;

/** STATE_META 单项(批头徽标簇 props 用)。 */
export type BatchStateMeta = (typeof STATE_META)[BatchStateKey];

export function batchState(b: CkptBatch): BatchStateKey {
  return b.open ? "open" : b.state;
}
