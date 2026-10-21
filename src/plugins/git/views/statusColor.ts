/**
 * 状态字母 → 文字色 —— DiffView / HistoryView / 提交 diff tab 共用。
 * M 的 token 由 kernel/themeTokens.ts 映射(editorWarning.foreground)。
 * 字母→语义判定消费 kernel/gitStatusColor 唯一源(批三收敛);本表只持
 * git 面板 token(文字色)。
 */
import { gitStatusSemantic, type GitStatusSemantic } from "@kernel/gitStatusColor";

/** 语义 → 文字色(git 面板 token)。 */
const SEMANTIC_CLS: Record<GitStatusSemantic, string> = {
  added: "text-(--tmd-diff-inserted)",
  deleted: "text-(--tmd-diff-removed)",
  modified: "text-(--tmd-git-modified)",
  renamed: "text-(--tmd-accent)",
  untracked: "text-(--tmd-fg-faint)",
};

/** 状态字母 → 文字色(键面与旧表一致;未知字母消费方 `??` 兜底)。 */
export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  (["A", "D", "M", "R", "T", "C", "?"] as const).map((st) => [st, SEMANTIC_CLS[gitStatusSemantic(st)]]),
);
