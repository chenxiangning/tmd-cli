/**
 * 行级 diff(写回预览用,零依赖)—— 首尾公共行修剪后余量即改动块。
 * 规则写回都是行级删改,该口径足够;渲染端自cap。
 */

export interface DiffLine {
  kind: "ctx" | "del" | "add";
  text: string;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const out: DiffLine[] = [];
  if (start > 0) out.push({ kind: "ctx", text: "…" });
  for (let i = start; i < endA; i++) out.push({ kind: "del", text: a[i]! });
  for (let i = start; i < endB; i++) out.push({ kind: "add", text: b[i]! });
  if (endA < a.length) out.push({ kind: "ctx", text: "…" });
  return out;
}
