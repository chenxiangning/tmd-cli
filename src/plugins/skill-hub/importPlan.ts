/**
 * 导入落位规划(纯函数,单测 seam)── 复制前一次性把所选目标分三类:
 * - inPlace:源即该落位目录(导入扫描源里的公约位/引擎组再次导回自家),
 *   免复制直接视为已满足 —— fsCopyTree 是新建语义,自我复制会报「同名已存在」;
 * - conflicts:同名已存在且非源。导入侧先检后动整体报错(重新导入的既定
 *   流程是「已安装」删除后再导),不做半落位;
 * - copy:空位,正常复制。
 */

const norm = (p: string): string => p.replace(/\/+$/, "");

export interface ImportPlan {
  /** 免复制目标 rel(源即此目录)。 */
  inPlace: string[];
  /** 待复制目标 rel。 */
  copy: string[];
  /** 冲突目标 rel(同名已存在且非源;调用方整体报错,一个都不落)。 */
  conflicts: string[];
}

export function planImportTargets(
  home: string,
  sourceDir: string,
  name: string,
  wanted: readonly string[],
  /** rel → 落位父目录已有条目名;undefined = 目录不存在(空位)。 */
  listingByRel: Readonly<Record<string, readonly string[] | undefined>>,
): ImportPlan {
  const inPlace: string[] = [];
  const copy: string[] = [];
  const conflicts: string[] = [];
  for (const rel of wanted) {
    const dest = norm(`${home}/${rel}/${name}`);
    if (dest === norm(sourceDir)) {
      inPlace.push(rel);
      continue;
    }
    const entries = listingByRel[rel];
    if (entries?.includes(name)) conflicts.push(rel);
    else copy.push(rel);
  }
  return { inPlace, copy, conflicts };
}
