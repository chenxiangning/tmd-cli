/**
 * unified patch 渲染 —— unified 单栏(旧/新双行号槽 + 行着色)与
 * split 双栏(左旧右新,del×add 按下标配对,空侧斜纹占位)两模式。
 * 解析与配对纯逻辑在 patchModel.ts(codemoss DiffBlock 同构);
 * 滚动容器尺寸由 className 传入(max-h-72 / h-full,各挂载点不同)。
 */

import { useMemo } from "react";

import type { GitDiffMode } from "@kernel/settings";
import { buildSplitRows, parsePatch, type PatchRow, type SplitRow } from "./patchModel";

/** 行底色/字色:单栏整行用,双栏按格用。 */
const ROW_CLS: Record<PatchRow["kind"], string> = {
  hunk: "my-1 border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[0.625rem] text-(--tmd-accent)",
  add: "bg-(color:--tmd-diff-inserted)/12 text-(--tmd-diff-inserted)",
  del: "bg-(color:--tmd-diff-removed)/12 text-(--tmd-diff-removed)",
  ctx: "text-(--tmd-fg-muted)",
  meta: "italic text-(--tmd-fg-faint)",
};

const GUTTER_CLS =
  "min-w-[2.5rem] shrink-0 select-none pr-1.5 text-right tabular-nums text-(--tmd-fg-faint)";
const CONTENT_CLS = "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2";

/** diff 行稳定 key:种类 + 旧/新行号 + 内容(同号重行以内容区分,索引 key 清零用)。 */
function patchRowKey(row: PatchRow): string {
  return `${row.kind}:${row.oldLine ?? "-"}:${row.newLine ?? "-"}:${row.text}`;
}

/** 单栏行号槽:旧/新两列,无号留空保对齐。 */
function Gutter({ oldLine, newLine }: { oldLine: number | null; newLine: number | null }) {
  return (
    <>
      <span className={GUTTER_CLS}>{oldLine ?? ""}</span>
      <span className={GUTTER_CLS}>{newLine ?? ""}</span>
    </>
  );
}
function UnifiedRow({ row }: { row: PatchRow }) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  return (
    <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      <span className={CONTENT_CLS}>{row.text}</span>
    </div>
  );
}

/** 双栏半格:有行 → 本侧行号(左旧右新) + 正文;空侧 → 斜纹占位。 */
function SplitCell({ row, side }: { row: PatchRow | null; side: "left" | "right" }) {
  const border = side === "left" ? "border-r border-(color:--tmd-border)" : "";
  if (!row) return <div className={`diff-split-empty ${border}`} aria-hidden />;
  const num = side === "left" ? row.oldLine : row.newLine;
  return (
    <div className={`flex ${ROW_CLS[row.kind]} ${border}`}>
      <span className={GUTTER_CLS}>{num ?? ""}</span>
      <span className={CONTENT_CLS}>{row.text}</span>
    </div>
  );
}

function SplitRows({ rows }: { rows: SplitRow[] }) {
  return (
    <>
      {rows.map((row) =>
        row.kind === "header" ? (
          <div key={patchRowKey(row.row)} className={row.row.kind === "hunk" ? ROW_CLS.hunk : `px-1 ${ROW_CLS.meta}`}>
            {row.row.text}
          </div>
        ) : (
          <div
            key={`${row.left ? patchRowKey(row.left) : "empty"}|${row.right ? patchRowKey(row.right) : "empty"}`}
            className="grid grid-cols-2 [content-visibility:auto] [contain-intrinsic-size:auto_1em]"
          >
            <SplitCell row={row.left} side="left" />
            <SplitCell row={row.right} side="right" />
          </div>
        ),
      )}
    </>
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
  const rows = useMemo(() => parsePatch(text), [text]);
  const splitRows = useMemo(() => (mode === "split" ? buildSplitRows(rows) : null), [mode, rows]);
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[0.6875rem] leading-tight`}>
      {splitRows ? (
        <SplitRows rows={splitRows} />
      ) : (
        rows.map((row) => <UnifiedRow key={patchRowKey(row)} row={row} />)
      )}
    </pre>
  );
}
