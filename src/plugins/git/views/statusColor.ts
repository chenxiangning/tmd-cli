/**
 * 状态字母 → 文字色 —— DiffView / HistoryView / 提交 diff tab 共用。
 * M 的 token 由 kernel/themeTokens.ts 映射(editorWarning.foreground)。
 */

export const STATUS_COLOR: Record<string, string> = {
  M: "text-(--tmd-git-modified)",
  A: "text-(--tmd-diff-inserted)",
  D: "text-(--tmd-diff-removed)",
  R: "text-(--tmd-accent)",
  T: "text-(--tmd-accent)",
  C: "text-(--tmd-diff-removed)",
  "?": "text-(--tmd-fg-faint)",
};
