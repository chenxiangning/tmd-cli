/**
 * 快开模糊打分 —— 自写 subsequence 匹配(spec 2026-09-18 取舍四:不引 fuzzy 库)。
 * 大小写不敏感;记分:词首命中(段首或 / - _ . 空格 之后)+8、连续命中 +2、
 * 位置罚分(越靠前越好)。非子序列返回 null。
 */

export interface FuzzyMatch {
  score: number;
  /** 命中下标集(快开高亮用,随 target 原序递增)。 */
  indices: number[];
}

const WORD_SEP: Record<string, true> = { "/": true, "-": true, _: true, ".": true, " ": true };
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let prev = -2; // 上一个命中下标(连续判定)
  let from = 0; // 贪心扫描起点
  for (let i = 0; i < q.length; i++) {
    const found = t.indexOf(q[i], from);
    if (found === -1) return null; // 不是子序列
    if (found === prev + 1) score += 2; // 连续
    if (found === 0 || WORD_SEP[t[found - 1]] === true) score += 8; // 词首
    score -= found / 64; // 位置罚分(深路径轻微降权)
    indices.push(found);
    prev = found;
    from = found + 1;
  }
  return { score, indices };
}
