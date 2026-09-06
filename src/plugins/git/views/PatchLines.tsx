/**
 * unified patch 行渲染 —— 状态机分类:首个 @@ 前的文件元数据头整段丢弃,
 * @@ 渲染为细分隔条,+/-/上下文逐行着色。
 * 从 DiffView 抽出:提交 diff tab(编辑器区大视口)复用同一渲染,
 * 只有滚动容器尺寸不同(className 传入 max-h-72 / h-full)。
 */

import { useMemo } from "react";

type PatchRow = { kind: "hunk" | "add" | "del" | "ctx" | "meta"; text: string };

/**
 * 单 delta patch(git2::Patch::to_buf)= 单文件段:首个 @@ 前的行全是
 * 元数据头(diff --git / index / --- / +++ / mode / rename …),整段丢弃。
 * 状态机而非逐行前缀猜测:正文里以 +/-/@@ 开头的代码行不受误伤。
 */
export function parsePatch(text: string): PatchRow[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop(); // 尾随换行的 split 残影
  const rows: PatchRow[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true;
      rows.push({ kind: "hunk", text: line });
    } else if (inHunk) {
      rows.push({
        kind: line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : line.startsWith("\\")
              ? "meta" // "\ No newline at end of file":末尾换行语义,保留
              : "ctx",
        text: line,
      });
    }
  }
  /* 无 @@ 的合法 patch(纯 mode 变更 / 子模块指针):没有"正文"可言,
     整段按 meta 呈现,避免 tab 空白且无任何说明。 */
  if (!inHunk) return lines.map((line) => ({ kind: "meta" as const, text: line }));
  return rows;
}

const ROW_CLS: Record<PatchRow["kind"], string> = {
  hunk: "my-1 border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[10px] text-(--tmd-accent)",
  add: "bg-(color:--tmd-diff-inserted)/12 text-(--tmd-diff-inserted)",
  del: "bg-(color:--tmd-diff-removed)/12 text-(--tmd-diff-removed)",
  ctx: "text-(--tmd-fg-muted)",
  meta: "italic text-(--tmd-fg-faint)",
};

export function PatchLines({ text, className = "max-h-72" }: { text: string; className?: string }) {
  const rows = useMemo(() => parsePatch(text), [text]);
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[11px] leading-tight`}>
      {rows.map((row, i) => (
        /* content-visibility:auto:数千行的 lockfile/生成代码 diff,
           视口外行跳过布局与绘制,展开不再卡顿 */
        <div
          key={i}
          className={`whitespace-pre-wrap break-all [content-visibility:auto] [contain-intrinsic-size:auto 1em] ${ROW_CLS[row.kind]}`}
        >
          {row.text}
        </div>
      ))}
    </pre>
  );
}
