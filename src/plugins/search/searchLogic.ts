/**
 * 全文/快开共用纯逻辑(D-04 测试缝;组件文件只出组件纪律,先例 fuzzy.ts):
 * - 全文命中按文件分组(保持首见顺序,行序即 walk 序自然递增);
 * - 快开打分排序截顶:空查询 = walk 序前 SHOW_LIMIT(零分通过语义),
 *   非空 = fuzzy 子序列过滤 + 分降序(同分路径字典序)截 SHOW_LIMIT;
 * - walk 上限(护栏在后端)与全文命中上限常量同源此处。
 */
import { fuzzyMatch } from "./fuzzy";

/** 全局命中上限(护栏在 fs_search.rs;命中即提示截断)。 */
export const MAX_RESULTS = 2000;
/** walk 上限(与 spec 一致);展示截断条数。 */
export const WALK_CAP = 5000;
export const SHOW_LIMIT = 50;

/** 命中按文件分组(保持首见顺序)。 */
export function groupByFile<T extends { path: string }>(hits: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const hit of hits) {
    const arr = groups.get(hit.path);
    if (arr) arr.push(hit);
    else groups.set(hit.path, [hit]);
  }
  return groups;
}

export interface QuickOpenRow {
  path: string;
  score: number;
  indices: number[];
}

/**
 * 快开展示行(walk 产物 → 展示前 50):
 * 目录项(尾 /)在装载侧已剔除,此处不重复过滤;空查询零分通过(全量列表语义);
 * 截断提示由调用方按 rows.length === SHOW_LIMIT 判定。
 */
export function quickOpenRows(files: readonly string[], query: string): QuickOpenRow[] {
  if (!query.trim()) {
    return files.slice(0, SHOW_LIMIT).map((p) => ({ path: p, score: 0, indices: [] }));
  }
  const scored: QuickOpenRow[] = [];
  for (const p of files) {
    const m = fuzzyMatch(query, p);
    if (m) scored.push({ path: p, score: m.score, indices: m.indices });
  }
  scored.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return scored.slice(0, SHOW_LIMIT);
}
