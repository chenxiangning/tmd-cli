import type { GitDiffStatus, WorktreeEntry } from "@kernel/ipc";

export type WorktreeDeliveryState = "clean" | "deliver" | "blocked";

/** 仅用本地分支集合判断交付态;PR 是否已合并不在无查询接口时猜测。 */
export function resolveWorktreeDelivery(ahead: number, canCreate: boolean): WorktreeDeliveryState {
  if (ahead === 0) return "clean";
  return canCreate ? "deliver" : "blocked";
}

export function canCreateWorktreePr(delivery: { canCreate: boolean } | undefined, ahead: number): boolean {
  return !delivery || (delivery.canCreate && ahead > 0);
}

/** detached 没有分支短名,比较直接取 HEAD;PR 表单仍保留原空分支并沿用禁用保护。 */
export function worktreeCompareName(entry: Pick<WorktreeEntry, "branch" | "detached">): string {
  return entry.detached ? "HEAD" : entry.branch;
}

export type WorktreeReview =
  | { mode: "diff"; sides: Array<"staged" | "worktree"> }
  | { mode: "compare"; target: string };

/** 脏树看未提交 diff；干净树按既有 PR 基线比较已提交内容。 */
export function resolveWorktreeReview(
  status: Pick<GitDiffStatus, "files">,
  defaultBase: string,
): WorktreeReview {
  if (status.files.length > 0) {
    return {
      mode: "diff",
      sides: [
        ...(status.files.some((f) => f.staged) ? ["staged" as const] : []),
        ...(status.files.some((f) => f.wt) ? ["worktree" as const] : []),
      ],
    };
  }
  return { mode: "compare", target: defaultBase };
}
