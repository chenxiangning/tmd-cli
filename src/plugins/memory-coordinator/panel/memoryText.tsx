/**
 * Memory 文案工具 —— 命中词高亮 + 类目中文 label。
 * 自 MemoryPanelParts.tsx 拆出(only-export-components 铁则);
 * MemoryConsoleStats 的同名私有副本一并收敛至此。
 */

import type { ReactNode } from "react";
import { CATEGORY_CN } from "../protocol";
import { t } from "@kernel/i18n";

/** 命中词高亮:按当前查询拆段包 <mark>(大小写不敏感,首处起全部命中)。 */
export function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const parts: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(ql, i);
    if (hit < 0 || n > 50) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(<mark key={hit} className="rounded-sm bg-(--tmd-accent-soft) px-px">{text.slice(hit, hit + q.length)}</mark>);
    i = hit + q.length;
    n += 1;
  }
  return parts;
}

export function categoryLabel(key: string): string {
  return t((CATEGORY_CN as Record<string, string>)[key] ?? key);
}
