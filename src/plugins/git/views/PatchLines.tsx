/**
 * diff 正文渲染:单栏(unified)与双栏(split)共用一套解析。
 * 双栏为 IntelliJ 并排式:中央行号槽(旧|新)对号、改动行红/绿淡染同行成对
 * (左红右绿即修改对,单侧红/绿即纯删/纯增)、空侧留白占位、
 * 修改对行内词级只做下划线标注。配色全部沿用既有 diff 变量,无新色。
 */
import { useMemo, useRef, type RefObject } from "react";
import type { GitDiffMode } from "@kernel/settings";
import { useGitPanelState } from "../panelStore";
import { buildSplitRows, parsePatch, type PatchRow, type SplitRow } from "./patchModel";

/** 行底色/字色:单栏整行用(经典红绿)。双栏不用整行字色,只做淡染带。 */
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
      <span className={`${GUTTER_CLS} pl-1.5 pr-0`}>{newLine ?? ""}</span>
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

/* ── 词级 diff(仅修改对):行内 token LCS;超限退化为整行标注 ── */

type WordPart = { text: string; tag?: "ins" | "del" };

const tokenRe = /[\w-]+|\s+|[^\w\s]/g;
const MAX_LDP_CELLS = 20000;

function wordDiff(a: string, b: string): [WordPart[], WordPart[]] {
  const A = a.match(tokenRe) ?? [a];
  const B = b.match(tokenRe) ?? [b];
  const n = A.length;
  const m = B.length;
  if (n * m > MAX_LDP_CELLS) return [[{ text: a, tag: "del" }], [{ text: b, tag: "ins" }]];
  /* LCS 长度表(行内 token 数小,压平一维)。 */
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * (m + 1) + j] =
        A[i] === B[j]
          ? dp[(i + 1) * (m + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
  const parts = (side: 0 | 1): WordPart[] => {
    const out: WordPart[] = [];
    const push = (text: string, tag: WordPart["tag"]) => {
      if (!text) return;
      const last = out[out.length - 1];
      if (last && last.tag === tag) last.text += text;
      else out.push({ text, tag });
    };
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) {
        push(A[i++], undefined);
        j++;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
        push(A[i++], side === 0 ? "del" : undefined);
      } else {
        push(B[j++], side === 1 ? "ins" : undefined);
      }
    }
    while (i < n) push(A[i++], side === 0 ? "del" : undefined);
    while (j < m) push(B[j++], side === 1 ? "ins" : undefined);
    return out;
  };
  return [parts(0), parts(1)];
}

function WordContent({ parts, wrap }: { parts: WordPart[]; wrap: boolean }) {
  return (
    <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>
      {parts.map((p, i) =>
        p.tag ? (
          <span
            key={i}
            className={p.tag === "ins" ? "git-split-word git-split-word-ins" : "git-split-word git-split-word-del"}
          >
            {p.text}
          </span>
        ) : (
          p.text
        ),
      )}
    </span>
  );
}

/* ── 双栏(IntelliJ 并排):三列 [左内容 | 中央行号槽 | 右内容] ── */

/** 双栏配对语义:双非空且文本不同 = 修改对(左红右绿同行),单侧 = 纯删/纯增。 */
type PairKind = "ctx" | "mod" | "del" | "add";
const pairKind = (left: PatchRow | null, right: PatchRow | null): PairKind =>
  left && right ? (left.text === right.text ? "ctx" : "mod") : left ? "del" : "add";

/** 色带 = 本侧行种类的经典淡染(与单栏同源变量);ctx/meta 无带。 */
const SIDE_BAND: Record<string, string> = {
  del: "git-split-band-del",
  add: "git-split-band-add",
};
const bandFor = (row: PatchRow | null) => (row ? SIDE_BAND[row.kind] ?? "" : "");

/** 改动块的引导框:连续非 ctx pair 行 = 一个块;框画在中央槽段上(top/mid/bot/single)。 */
type FrameKind = null | "top" | "mid" | "bot" | "single";
function frameMap(rows: SplitRow[]): FrameKind[] {
  const out: FrameKind[] = rows.map((r) => (r.kind === "pair" && pairKind(r.left, r.right) !== "ctx" ? "mid" : null));
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const start = i;
    while (i < out.length && out[i]) i++;
    const end = i - 1;
    out[start] = start === end ? "single" : "top";
    if (end > start) out[end] = "bot";
  }
  return out;
}

const FRAME_CLS: Record<string, string> = {
  top: "git-split-frame git-split-frame-top",
  mid: "git-split-frame",
  bot: "git-split-frame git-split-frame-bot",
  single: "git-split-frame git-split-frame-top git-split-frame-bot",
};

/** 中央行号槽一格:旧行号居左、新行号居右;缺侧画空槽占位(⬚),改动行数字提亮。 */
function SlotGutter({ left, right, chg }: { left: PatchRow | null; right: PatchRow | null; chg?: boolean }) {
  return (
    <div className={`git-split-gutter-row ${chg ? "git-split-gutter-chg" : ""}`}>
      {left ? <span>{left.oldLine}</span> : <span className="git-split-gslot-empty" aria-hidden />}
      {right ? <span>{right.newLine}</span> : <span className="git-split-gslot-empty" aria-hidden />}
    </div>
  );
}
/** 换行态双栏:逐行三列 grid,行行对齐(原始结构,列扩为 1fr|auto|1fr)。 */
function SplitRows({ rows, wrap }: { rows: SplitRow[]; wrap: boolean }) {
  const frames = useMemo(() => frameMap(rows), [rows]);
  return (
    <>
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div key={patchRowKey(row.row)} className={row.row.kind === "hunk" ? ROW_CLS.hunk : `px-1 ${ROW_CLS.meta}`}>
            {row.row.text}
          </div>
        ) : (
          <PairRow
            key={`${row.left ? patchRowKey(row.left) : "empty"}|${row.right ? patchRowKey(row.right) : "empty"}`}
            row={row}
            wrap={wrap}
            frame={frames[i]}
          />
        ),
      )}
    </>
  );
}

function PairRow({
  row,
  wrap,
  frame,
}: {
  row: { left: PatchRow | null; right: PatchRow | null };
  wrap: boolean;
  frame: FrameKind;
}) {
  const kind = pairKind(row.left, row.right);
  const [dParts, iParts] = kind === "mod" ? wordDiff(row.left!.text, row.right!.text) : [null, null];
  return (
    /* 三列:左 1fr | 槽 auto | 右 1fr;同行共享行高,红绿同排对位,空侧留白。 */
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [content-visibility:auto] [contain-intrinsic-size:auto_1em]">
      <div className={`flex min-w-0 px-2 ${bandFor(row.left)}`}>
        {dParts ? (
          <WordContent parts={dParts} wrap={wrap} />
        ) : (
          <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>{row.left?.text ?? ""}</span>
        )}
      </div>
      <div className={FRAME_CLS[frame!]}>
        <SlotGutter left={row.left} right={row.right} chg={kind !== "ctx"} />
      </div>
      <div className={`flex min-w-0 px-2 ${bandFor(row.right)}`}>
        {iParts ? (
          <WordContent parts={iParts} wrap={wrap} />
        ) : (
          <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>{row.right?.text ?? ""}</span>
        )}
      </div>
    </div>
  );
}

/** 关闭换行:左右两个独立横向滚动面 + 中央槽,纵向镜像同步
 *  (nowrap 行高恒单行,三栏行数一致,无需逐行测量)。 */
function SplitHalvesSynced({ rows }: { rows: SplitRow[] }) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const mirror =
    (src: RefObject<HTMLDivElement | null>, dst: RefObject<HTMLDivElement | null>[]) => () => {
      if (syncingRef.current || !src.current) return;
      syncingRef.current = true;
      for (const d of dst) if (d.current) d.current.scrollTop = src.current.scrollTop;
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
  const side = (isLeft: boolean) => {
    const me = isLeft ? leftRef : rightRef;
    const targets = isLeft ? [rightRef, midRef] : [leftRef, midRef];
    return (
      <div ref={me} onScroll={mirror(me, targets)} className="h-full min-w-0 overflow-auto px-2">
        {rows.map((row) =>
          row.kind === "header" ? (
            <div
              key={`h:${patchRowKey(row.row)}`}
              className={row.row.kind === "hunk" ? ROW_CLS.hunk : "italic text-(--tmd-fg-faint)"}
            >
              {row.row.text}
            </div>
          ) : (
            (() => {
              const kind = pairKind(row.left, row.right);
              const self = isLeft ? row.left : row.right;
              if (!self) return <div key={`e:${patchRowKey((isLeft ? row.right : row.left)!)}`} />;
              const parts =
                kind === "mod"
                  ? isLeft
                    ? wordDiff(self.text, row.right!.text)[0]
                    : wordDiff(row.left!.text, self.text)[1]
                  : null;
              return (
                <div key={patchRowKey(self)} className={bandFor(self)}>
                  {parts ? (
                    <WordContent parts={parts} wrap={false} />
                  ) : (
                    <span className={CONTENT_NOWRAP_CLS}>{self.text}</span>
                  )}
                </div>
              );
            })()
          ),
        )}
      </div>
    );
  };
  const frames = useMemo(() => frameMap(rows), [rows]);
  const mid = (
    <div ref={midRef} className="h-full overflow-hidden border-x border-(color:--tmd-border)">
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div key={`h:${patchRowKey(row.row)}`} />
        ) : (
          <div key={`g:${patchRowKey(row.left ?? row.right!)}`} className={FRAME_CLS[frames[i]!]}>
            <SlotGutter left={row.left} right={row.right} chg={pairKind(row.left, row.right) !== "ctx"} />
          </div>
        ),
      )}
    </div>
  );
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
      {side(true)}
      {mid}
      {side(false)}
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
    /* 双栏 nowrap:外层不滚,横向滚动条归左右两半各自所有。 */
    return (
      <pre className={`${className} overflow-hidden py-1 font-mono text-[0.6875rem] leading-tight`}>
        <SplitHalvesSynced rows={splitRows} />
      </pre>
    );
  }
  return (
    <pre className={`${className} overflow-auto py-1 font-mono text-[0.6875rem] leading-tight ${splitRows ? "" : "px-3"}`}>
      {splitRows ? (
        <SplitRows rows={splitRows} wrap={diffWrap} />
      ) : (
        rows.map((row) => <UnifiedRow key={patchRowKey(row)} row={row} wrap={diffWrap} />)
      )}
    </pre>
  );
}
