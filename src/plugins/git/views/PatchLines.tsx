/**
 * unified patch 渲染 —— unified 单栏(旧/新双行号槽 + 行着色)与
 * split 双栏(左旧右新,del×add 按下标配对,空侧斜纹占位)两模式。
 * 解析与配对纯逻辑在 patchModel.ts(codemoss DiffBlock 同构);
 * 滚动容器尺寸由 className 传入(max-h-72 / h-full,各挂载点不同)。
 */

import { useMemo, useRef, type RefObject } from "react";
import type { GitDiffMode } from "@kernel/settings";
import { useGitPanelState } from "../panelStore";
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
const CONTENT_WRAP_CLS = "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2";
/* 关闭换行:正文不收缩(shrink-0),行宽随内容撑出 <pre> 的横向滚动区。 */
const CONTENT_NOWRAP_CLS = "shrink-0 whitespace-pre pl-2";

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
function UnifiedRow({ row, wrap }: { row: PatchRow; wrap: boolean }) {
  if (row.kind === "hunk") return <div className={ROW_CLS.hunk}>{row.text}</div>;
  return (
    <div className={`flex [content-visibility:auto] [contain-intrinsic-size:auto_1em] ${ROW_CLS[row.kind]}`}>
      <Gutter oldLine={row.oldLine} newLine={row.newLine} />
      <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>{row.text}</span>
    </div>
  );
}

/** 双栏半格:有行 → 本侧行号(左旧右新) + 正文;空侧 → 斜纹占位。 */
function SplitCell({ row, side, wrap }: { row: PatchRow | null; side: "left" | "right"; wrap: boolean }) {
  const border = side === "left" ? "border-r border-(color:--tmd-border)" : "";
  if (!row) return <div className={`diff-split-empty ${border}`} aria-hidden />;
  const num = side === "left" ? row.oldLine : row.newLine;
  return (
    <div className={`flex ${ROW_CLS[row.kind]} ${border}`}>
      <span className={GUTTER_CLS}>{num ?? ""}</span>
      <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>{row.text}</span>
    </div>
  );
}
/** 双栏逐行配对 grid(原始结构,换行态):同行左右格共享行高,行行对齐。 */
function SplitRows({ rows, wrap }: { rows: SplitRow[]; wrap: boolean }) {
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
            <SplitCell row={row.left} side="left" wrap={wrap} />
            <SplitCell row={row.right} side="right" wrap={wrap} />
          </div>
        ),
      )}
    </>
  );
}

/** 双栏关闭换行:左右两个独立滚动面 —— 横向各自滚(各自滚动条),
 *  纵向镜像同步。nowrap 行高恒单行,两侧行数一致,无需逐行对齐。 */
function SplitHalvesSynced({ rows }: { rows: SplitRow[] }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const mirror = (src: RefObject<HTMLDivElement | null>, dst: RefObject<HTMLDivElement | null>) => () => {
    if (syncingRef.current || !src.current || !dst.current) return;
    syncingRef.current = true;
    dst.current.scrollTop = src.current.scrollTop;
    requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };
  const side = (items: (PatchRow | "header" | null)[], isLeft: boolean) => (
    <div
      ref={isLeft ? leftRef : rightRef}
      onScroll={isLeft ? mirror(leftRef, rightRef) : mirror(rightRef, leftRef)}
      className={`h-full overflow-auto ${isLeft ? "border-r border-(color:--tmd-border)" : ""}`}
    >
      {items.map((item, i) => {
        if (item === null) {
          const row = rows[i];
          const anchor = row.kind === "header" ? row.row : row.left ?? row.right;
          return <div key={`e:${anchor ? patchRowKey(anchor) : "empty"}`} className="diff-split-empty" aria-hidden />;
        }
        if (item === "header") {
          const header = rows[i];
          if (header.kind !== "header") return null;
          return (
            <div key={`h:${patchRowKey(header.row)}`} className={header.row.kind === "hunk" ? ROW_CLS.hunk : `px-1 ${ROW_CLS.meta}`}>
              {header.row.text}
            </div>
          );
        }
        return (
          <div key={patchRowKey(item)} className={`flex ${ROW_CLS[item.kind]}`}>
            <span className={GUTTER_CLS}>{(isLeft ? item.oldLine : item.newLine) ?? ""}</span>
            <span className={CONTENT_NOWRAP_CLS}>{item.text}</span>
          </div>
        );
      })}
    </div>
  );
  const leftItems = rows.map((r) => (r.kind === "header" ? "header" : r.left));
  const rightItems = rows.map((r) => (r.kind === "header" ? "header" : r.right));
  return (
    <div className="grid h-full grid-cols-2">
      {side(leftItems, true)}
      {side(rightItems, false)}
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
  const splitRows = useMemo(() => (mode === "split" ? buildSplitRows(rows) : null), [mode, rows]);
  if (splitRows && !diffWrap) {
    /* 双栏 nowrap 走双滚动面:外层不滚,横向滚动条归左右两半各自所有。 */
    return (
      <pre className={`${className} overflow-hidden px-0 py-1 font-mono text-[0.6875rem] leading-tight`}>
        <SplitHalvesSynced rows={splitRows} />
      </pre>
    );
  }
  return (
    <pre className={`${className} overflow-auto px-3 py-1 font-mono text-[0.6875rem] leading-tight`}>
      {splitRows ? (
        <SplitRows rows={splitRows} wrap={diffWrap} />
      ) : (
        rows.map((row) => <UnifiedRow key={patchRowKey(row)} row={row} wrap={diffWrap} />)
      )}
    </pre>
  );
}
