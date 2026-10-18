/**
 * diff 正文渲染分发:
 * 单栏(unified)= 自绘经典红绿 + mod 对词级标注(与双栏同一 buildSplitRows
 *   配对、同一 wordDiff DP)+ 全文态未改动段折叠(段内 ctx 行隐去,展开入口
 *   在头部工具条);双栏(split)= SplitDiffView(中缝连接带自绘四列:左内容|
 *   旧号|新号|右内容,nowrap 态左右独立横滚 + 双号槽纵同步,见该文件头注)。
 * path 供 Prism 语言解析 → 正文静态上色(CodeSpan/WordContent,内核
 * syntaxHighlight 同一 --tmd-syntax-* 色板)。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GitDiffMode } from "@kernel/settings";
import { prismLangOf } from "@kernel/syntaxHighlight";
import { diffNoteRevealRef, lineHash, noteKey, type DiffNote } from "../diffNotes";
import { NoteBubble, NoteEditor, NoteHoverButton } from "./NoteInline";
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

/** 行级批注上下文:启用后行悬停显批注钮、行侧渲染气泡、揭示桥可定位。 */
export interface PatchNoteCtx {
  file: string;
  notes: readonly DiffNote[];
  onAdd: (hash: string, lineNo: number, text: string, excerpt: string) => void;
}

function UnifiedRow({
  row,
  wrap,
  parts,
  lang,
  ctx,
  rowNotes,
  editingKey,
  onStartEdit,
  onEndEdit,
  flash,
}: {
  row: PatchRow;
  wrap: boolean;
  parts: WordPart[] | null;
  lang: string;
  ctx: PatchNoteCtx | null;
  /** 归属本行的批注(逐条裁决);undefined = 本行不持有任何批注锚。 */
  rowNotes: readonly DiffNote[] | undefined;
  editingKey: string | null;
  onStartEdit: (key: string) => void;
  onEndEdit: () => void;
  flash: boolean;
}) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  const content = wrap
    ? "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2"
    : "min-w-0 flex-1 shrink-0 whitespace-pre pl-2";
  const line = (
    <>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      {parts ? <WordContent parts={parts} wrap={wrap} lang={lang} /> : <CodeSpan text={row.text} lang={lang} className={content} />}
      {ctx && (
        <NoteHoverButton
          onStart={() => onStartEdit(patchRowKey(row))}
        />
      )}
    </>
  );
  /* 无批注上下文:保持原单层结构(零额外 DOM);启用后才包行容器挂气泡/编辑态。 */
  if (!ctx) {
    return <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>{line}</div>;
  }
  const key = noteKey(ctx.file, lineHash(row.text));
  /* 逐条归属裁决后的本行批注;非持有行只留添加钮(不挂气泡/定位锚/闪示)。 */
  const editing = editingKey === patchRowKey(row);
  return (
    <div
      data-dnkey={rowNotes ? key : undefined}
      className={`group relative ${ROW_CLS[row.kind]} ${flash ? "outline outline-1 -outline-offset-1 outline-(--tmd-accent)" : ""}`}
    >
      <div className="flex [content-visibility:auto] [contain-intrinsic-size:auto_1em]">{line}</div>
      {rowNotes?.map((n) => (
        <NoteBubble key={n.id} note={n} />
      ))}
      {editing && (
        <NoteEditor
          onCommit={(text) => {
            ctx.onAdd(lineHash(row.text), row.newLine ?? row.oldLine ?? 0, text, row.text);
            onEndEdit();
          }}
          onCancel={onEndEdit}
        />
      )}
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
  noteCtx,
}: {
  rows: PatchRow[];
  wrap: boolean;
  fold: boolean;
  lang: string;
  className: string;
  noteCtx: PatchNoteCtx | null;
}) {
  const runs = useMemo(() => (fold ? planUnifiedFolds(rows) : null), [rows, fold]);
  const items = useMemo(() => visiblePatchRows(rows, runs), [rows, runs]);
  const ctx = noteCtx;
  /* 逐条归属裁决:每条批注归 |行号−批注行号| 最小的同文可见行(同分取首现),
   * 一行可承载多条;气泡/揭示锚不再散挂到所有同文行。 */
  const notesForRow = useMemo(() => {
    if (!ctx || ctx.notes.length === 0) return undefined;
    const m = new Map<PatchRow, DiffNote[]>();
    for (const n of ctx.notes) {
      let best: PatchRow | null = null;
      let bestD = Infinity;
      for (const row of items) {
        if (row.kind === "hunk") continue;
        if (lineHash(row.text) !== n.lineHash) continue;
        const d = Math.abs((row.newLine ?? row.oldLine ?? 0) - n.lineNo);
        if (d < bestD) {
          bestD = d;
          best = row;
        }
      }
      if (best) {
        const list = m.get(best);
        if (list) list.push(n);
        else m.set(best, [n]);
      }
    }
    return m;
  }, [ctx, items]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  /* 揭示桥:列表卡点击 → 定位 diff 行 + 闪示 1.4s;仅批注上下文在挂时接管。
   * 卸载身份守卫(Composer.tsx 先例):后挂者覆盖时本例卸载不清掉他人 handler。 */
  useEffect(() => {
    if (!ctx) return;
    const impl = (key: string) => {
      preRef.current
        ?.querySelector(`[data-dnkey="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "center" });
      setFlashKey(key);
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlashKey(null), 1400);
    };
    diffNoteRevealRef.current = impl;
    return () => {
      if (diffNoteRevealRef.current === impl) diffNoteRevealRef.current = null;
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    };
  }, [ctx]);
  const preRef = useRef<HTMLPreElement>(null);
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
    <pre ref={preRef} className={`${className} overflow-auto px-3 py-1 font-mono text-xs leading-tight`}>
      {items.map((item) => (
        <UnifiedRow
          key={patchRowKey(item)}
          row={item}
          wrap={wrap}
          parts={wordParts.get(item) ?? null}
          lang={lang}
          ctx={ctx}
          rowNotes={notesForRow?.get(item)}
          editingKey={editingKey}
          onStartEdit={setEditingKey}
          onEndEdit={() => setEditingKey(null)}
          flash={
            ctx != null &&
            flashKey === noteKey(ctx.file, lineHash(item.text)) &&
            notesForRow?.has(item) === true
          }
        />
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
  noteCtx = null,
}: {
  text: string;
  className?: string;
  mode?: GitDiffMode;
  /** 全文态未改动段折叠:段内 ctx 行隐去(展开入口在头部工具条)。 */
  fold?: boolean;
  /** 文件路径 → Prism 语言(缺省不上色)。 */
  path?: string | null;
  /** 行级批注上下文(CommitDiffTab 注入):启用行悬停批注/气泡/揭示;单栏渲染生效。 */
  noteCtx?: PatchNoteCtx | null;
}) {
  const { diffWrap } = useGitPanelState();
  const rows = useMemo(() => parsePatch(text), [text]);
  const lang = path ? prismLangOf(path) ?? "" : "";
  if (mode === "split") {
    return <SplitDiffView rows={rows} wrap={diffWrap} className={className} fold={fold} lang={lang} />;
  }
  return <UnifiedLines rows={rows} wrap={diffWrap} fold={fold} lang={lang} className={className} noteCtx={noteCtx} />;
}
