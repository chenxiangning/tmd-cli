/**
 * 文件候选模糊匹配 ── 纯函数,零 IO(索引缓存在 ./fileIndex)。
 *
 * smart-case 子序列(fzf 风格):needle 含大写 → 大小写敏感,全小写 → 双匹配。
 * 得分偏好:连续片段、路径段首(/ 后或路径开头)、basename 开头;惩罚跳跃与长路径。
 */

/** 模糊得分;不命中返回 null。 */
export function fuzzyFileScore(path: string, needle: string): number | null {
  const sensitive = needle !== needle.toLowerCase();
  const hay = sensitive ? path : path.toLowerCase();
  const nd = sensitive ? needle : needle.toLowerCase();

  let score = 0;
  let hayIdx = 0;
  let streak = 0;
  const baseStart = path.lastIndexOf("/") + 1;
  for (let i = 0; i < nd.length; i++) {
    const found = hay.indexOf(nd[i], hayIdx);
    if (found < 0) return null;
    /* 连续命中加分;段首(/ 后或路径开头)与 basename 开头额外加分 */
    if (found === hayIdx && i > 0) score += 3 + streak;
    streak = found === hayIdx ? streak + 1 : 0;
    if (found === 0 || hay[found - 1] === "/") score += 5;
    if (found === baseStart) score += 4;
    score -= Math.min(found - hayIdx, 5);
    hayIdx = found + 1;
  }
  /* 短路径优先(同为模糊命中时,越近顶层越可能是目标) */
  score -= Math.min(path.length, 120) / 24;
  return score;
}

/**
 * 候选过滤:空 needle 直接返回前 limit(字典序 = 目录树稳定前缀);
 * 非空按得分降序,平手保持原索引序(输入已按字典序排好)。
 */
export function fuzzyFileMatch(files: string[], needle: string, limit = 20): string[] {
  if (!needle) return files.slice(0, limit);
  const scored: Array<{ path: string; score: number; idx: number }> = [];
  for (let idx = 0; idx < files.length; idx++) {
    const score = fuzzyFileScore(files[idx], needle);
    if (score !== null) scored.push({ path: files[idx], score, idx });
  }
  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored.slice(0, limit).map((s) => s.path);
}
