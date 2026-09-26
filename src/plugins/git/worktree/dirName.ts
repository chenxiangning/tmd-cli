/**
 * worktree UI 纯函数 ── 分支名 → 目录名推导与校验(单测覆盖)。
 * 路径拼接恒为 `父目录/目录名`(父目录 = 主仓 cwd 的 dirname),不收用户手输路径。
 */

/** 非法字符(空白/路径分隔/Windows 保留符/控制符)→ '-'。 */
function sanitizePart(part: string): string {
  return part.replace(/[\s/\\:*?"<>|\u0000-\u001f~^]+/g, "-");
}

/** 分支名 → worktree 目录名:`feature/x` → `feature-x`,`release/v1.2` → `release-v1.2`。 */
export function dirNameFromBranch(branch: string): string {
  const cleaned = sanitizePart(branch.trim())
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned;
}

/** 目录名校验:返回错误文案;null = 合法。 */
export function validateDirName(name: string): string | null {
  const n = name.trim();
  if (!n) return "目录名不能为空";
  if (n === "." || n === ".." || n.startsWith(".")) return "目录名不能以点开头";
  if (/[\s:\\*?"<>|\u0000-\u001f/]/.test(n)) return "目录名含非法字符";
  return null;
}

/** 由 cwd 与目录名拼 worktree 绝对路径;cwd 为盘根(无父目录)= null(UI 报错)。 */
export function worktreePathFor(cwd: string, name: string): string | null {
  const parent = cwd.replace(/[\\/]+$/, "");
  const at = Math.max(parent.lastIndexOf("/"), parent.lastIndexOf("\\"));
  if (at <= 0) return null; // 盘根仓库:worktree 会嵌进主仓,拒绝
  const dir = parent.slice(0, at);
  return `${dir}/${name.trim()}`;
}
