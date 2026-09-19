/**
 * 双栏 diff 类名表 —— 正文格 / hunk 通栏 / 色带与缺侧空带;纯数据 + 一行查表,
 * 无组件(splitCells.tsx 与 SplitDiffView 共用,组件文件不放非组件导出)。
 */

/* 正文格:wrap 换行 / nowrap 撑出滚动面。 */
export const CONTENT_WRAP_CLS = "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2";
export const CONTENT_NOWRAP_CLS = "shrink-0 whitespace-pre pl-2";

/** hunk 头 / meta 行通栏样式。行高多面一致靠 min-h-[1.25em](空占位无文字也
 *  与带字行等高;1.25em = pre 的 leading-tight 行高,不用 lh 单位——老
 *  WebKit(Tauri 系统 WebView)不支持,静默塌行)。halves 模式另用 *_NW:
 *  whitespace-pre 恒单行,超长头随该列横滚,不撑高错位。 */
export const HEADER_CLS: Record<"hunk" | "meta", string> = {
  hunk: "my-1 min-h-[1.25em] border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[0.625rem] text-(--tmd-accent)",
  meta: "min-h-[1.25em] px-1 italic text-(--tmd-fg-faint)",
};
export const HEADER_NW_CLS: Record<"hunk" | "meta", string> = {
  hunk: `${HEADER_CLS.hunk} whitespace-pre`,
  meta: `${HEADER_CLS.meta} whitespace-pre`,
};

/** 色带:本侧行种类淡染;缺侧空带 = 对侧种类减半淡染(GitHub empty-cell:
 *  纯删右侧浅红、纯增左侧浅绿)。 */
const SIDE_BAND: Record<string, string> = {
  del: "git-split-band-del",
  add: "git-split-band-add",
};
const EMPTY_BAND: Record<string, string> = {
  del: "git-split-empty-del",
  add: "git-split-empty-add",
};
export const sideBand = (self: { kind: string } | null, other: { kind: string } | null): string =>
  self ? (SIDE_BAND[self.kind] ?? "") : other ? (EMPTY_BAND[other.kind] ?? "") : "";
