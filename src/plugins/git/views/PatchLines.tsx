/**
 * diff 正文渲染分发:单栏(unified)= 自绘经典红绿;双栏(split)= SplitDiffView
 * (自绘三列:左右独立横向滚动 + 中央行号槽 + 改动块边框,见该文件头注)。
 */
import { useMemo } from "react";
import type { GitDiffMode } from "@kernel/settings";
import type { PatchRow } from "./patchModel";
import { parsePatch, patchRowKey } from "./patchModel";
import { SplitDiffView } from "./SplitDiffView";
import { useGitPanelState } from "../panelStore";

/** 行底色/字色:单栏整行用(经典红绿)。 */
const ROW_CLS: Record<string, string> = {
  hunk: "my-1 border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[0.625rem] text-(--tmd-accent)",
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

function UnifiedRow({ row, wrap }: { row: PatchRow; wrap: boolean }) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  const content = wrap
    ? "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2"
    : "min-w-0 flex-1 shrink-0 whitespace-pre pl-2";
  return (
    <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      <span className={content}>{row.text}</span>
    </div>
  );
}

export function PatchLines({
  text,
  className = "max-h-72",
  mode = "unified",
}: {
  text: string;
  className?: string;
  mode?: GitDiffMode;
}) {
  const { diffWrap } = useGitPanelState();
  const rows = useMemo(() => parsePatch(text), [text]);
  if (mode === "split") {
    return <SplitDiffView rows={rows} wrap={diffWrap} className={className} />;
  }
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[0.6875rem] leading-tight`}>
      {rows.map((row) => (
        <UnifiedRow key={patchRowKey(row)} row={row} wrap={diffWrap} />
      ))}
    </pre>
  );
}
