/**
 * diff 正文渲染分发:
 * 单栏(unified)= 自绘经典红绿 + mod 对词级标注(与双栏同一 buildSplitRows
 *   配对、同一 wordDiff DP)+ 全文态未改动段折叠(段内 ctx 行隐去,展开入口
 *   在头部工具条);双栏(split)= SplitDiffView(中缝连接带自绘四列:左内容|
 *   旧号|新号|右内容,nowrap 态左右独立横滚 + 双号槽纵同步,见该文件头注)。
 * path 供 Prism 语言解析 → 正文静态上色(CodeSpan/WordContent,内核
 * syntaxHighlight 同一 --tmd-syntax-* 色板)。
 */
import { useMemo } from "react";
import type { GitDiffMode } from "@kernel/settings";
import { prismLangOf } from "@kernel/syntaxHighlight";
import {
  buildSplitRows,
  pairKind,
  parsePatch,
  patchRowKey,
  planUnifiedFolds,
  visiblePatchRows,
  type PatchRow,
} from "./patchModel";
import { wordDiff, type WordPart } from "./wordDiff";
import { CodeSpan, WordContent } from "./splitCells";
import { SplitDiffView } from "./SplitDiffView";
import { useGitPanelState } from "../panelStore";

/** 行底色/字色:单栏整行用(经典红绿)。 */
const ROW_CLS: Record<string, string> = {
  hunk: "my-1 border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-meta text-(--tmd-accent)",
  add: "bg-(color:--tmd-diff-inserted)/12 text-(--tmd-diff-inserted)",
  del: "bg-(color:--tmd-diff-removed)/12 text-(--tmd-diff-removed)",
  ctx: "text-(--tmd-fg-muted)",
  meta: "italic text-(--tmd-fg-faint)",
};

const GUTTER_CLS =
  "min-w-[2.5rem] shrink-0 select-none pr-1.5 text-right tabular-nums text-(--tmd-fg-faint)";

function Gutter({ oldLine, newLine }: { oldLine: number | null; newLine: number | null }) {
  return (
    <>
      <span className={GUTTER_CLS}>{oldLine ?? ""}</span>
      <span className={`${GUTTER_CLS} pl-1.5 pr-0`}>{newLine ?? ""}</span>
    </>
  );
}

function UnifiedRow({ row, wrap, parts, lang }: { row: PatchRow; wrap: boolean; parts: WordPart[] | null; lang: string }) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  const content = wrap
    ? "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2"
    : "min-w-0 flex-1 shrink-0 whitespace-pre pl-2";
  return (
    <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      {parts ? <WordContent parts={parts} wrap={wrap} lang={lang} /> : <CodeSpan text={row.text} lang={lang} className={content} />}
    </div>
  );
}

/** 单栏渲染:词级标注(mod 对)+ 全文态未改动段过滤;两能力皆与双栏同源。 */
function UnifiedLines({
  rows,
  wrap,
  fold,
  lang,
  className,
}: {
  rows: PatchRow[];
  wrap: boolean;
  fold: boolean;
  lang: string;
  className: string;
}) {
  const runs = useMemo(() => (fold ? planUnifiedFolds(rows) : null), [rows, fold]);
  const items = useMemo(() => visiblePatchRows(rows, runs), [rows, runs]);
  /* mod 对词级标注:与双栏同一配对(zip)同一 DP;键 = 行对象身份
     (parsePatch 产出在 rows 生命周期内稳定,重拉换代自动作废)。 */
  const wordParts = useMemo(() => {
    const map = new Map<PatchRow, WordPart[]>();
    for (const sr of buildSplitRows(rows)) {
      if (sr.kind === "pair" && pairKind(sr.left, sr.right) === "mod") {
        const [del, ins] = wordDiff(sr.left!.text, sr.right!.text);
        map.set(sr.left!, del);
        map.set(sr.right!, ins);
      }
    }
    return map;
  }, [rows]);
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-xs leading-tight`}>
      {items.map((item) => (
        <UnifiedRow key={patchRowKey(item)} row={item} wrap={wrap} parts={wordParts.get(item) ?? null} lang={lang} />
      ))}
    </pre>
  );
}

export function PatchLines({
  text,
  className = "max-h-72",
  mode = "unified",
  fold = false,
  path,
}: {
  text: string;
  className?: string;
  mode?: GitDiffMode;
  /** 全文态未改动段折叠:段内 ctx 行隐去(展开入口在头部工具条)。 */
  fold?: boolean;
  /** 文件路径 → Prism 语言(缺省不上色)。 */
  path?: string | null;
}) {
  const { diffWrap } = useGitPanelState();
  const rows = useMemo(() => parsePatch(text), [text]);
  const lang = path ? prismLangOf(path) ?? "" : "";
  if (mode === "split") {
    return <SplitDiffView rows={rows} wrap={diffWrap} className={className} fold={fold} lang={lang} />;
  }
  return <UnifiedLines rows={rows} wrap={diffWrap} fold={fold} lang={lang} className={className} />;
}
