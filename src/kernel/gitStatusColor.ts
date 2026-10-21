/**
 * git 状态字母 → 语义判定(kernel 唯一源,0.4.2 批三收敛):
 * git 面板 STATUS_COLOR 与 checkpoints fileChipCls 曾各持一份字母梯子;
 * 收敛为一张语义表,两面各自派生 token(文字色 / chip 底+字)。
 * files 树 gitDecorateModel 有意不并:其字母→色是用户口径逐字母校准
 * (T→树蓝、R→蓝、?→绿),与面板语义(renamed→accent 等)不同表。
 */

export type GitStatusSemantic = "added" | "deleted" | "modified" | "renamed" | "untracked";

/** git 状态字母(含 porcelain 别名)→ 语义;未知字母归 modified(审查态)。 */
export function gitStatusSemantic(st: string): GitStatusSemantic {
  if (st === "A") return "added";
  if (st === "D" || st === "C") return "deleted";
  if (st === "R" || st === "T") return "renamed";
  if (st === "?") return "untracked";
  return "modified";
}
