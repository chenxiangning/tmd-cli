/**
 * unified patch 行渲染 —— 逐行按 +/-/@@ 着色。
 * 从 DiffView 抽出:提交 diff tab(编辑器区大视口)复用同一渲染,
 * 只有滚动容器尺寸不同(className 传入 max-h-72 / h-full)。
 */

export function PatchLines({ text, className = "max-h-72" }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[11px] leading-tight`}>
      {lines.map((line, i) => {
        const cls =
          line.startsWith("+") && !line.startsWith("+++")
            ? "bg-(color:--tmd-diff-inserted)/12 text-(--tmd-diff-inserted)"
            : line.startsWith("-") && !line.startsWith("---")
              ? "bg-(color:--tmd-diff-removed)/12 text-(--tmd-diff-removed)"
              : line.startsWith("@@")
                ? "text-(--tmd-accent)"
                : "text-(--tmd-fg-muted)";
        return (
          /* content-visibility:auto:数千行的 lockfile/生成代码 diff,
             视口外行跳过布局与绘制,展开不再卡顿 */
          <div
            key={i}
            className={`whitespace-pre-wrap break-all [content-visibility:auto] [contain-intrinsic-size:auto 1em] ${cls}`}
          >
            {line}
          </div>
        );
      })}
    </pre>
  );
}
