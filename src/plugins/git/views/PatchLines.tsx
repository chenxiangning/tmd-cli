/**
 * diff 正文渲染:单栏(unified)与双栏(split)。
 * 双栏按 IntelliJ IDEA SimpleDiffViewer 复刻(反译自本机 IDEA 3 的
 * com/intellij/diff/tools/simple/* 与 DiffDrawUtil):
 * - 行对位 = 缺侧渲染等高空行(IDEA 的镜像 block inlay);
 * - 占位行在中央槽涂类型色块(IDEA DiffInlayGutterMarkerRenderer.fillRect);
 * - 改动块在中央槽画右弯贝塞尔弧(IDEA DiffDrawUtil.makeCurve:控制点 30%/70%);
 * - 旧行号 ⤶ 钩、缺侧 ⬚ 空槽;配色全部沿用既有 diff 变量。
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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

/** diff 行稳定 key:种类 + 旧/新行号 + 内容。 */
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

/* ── 双栏(IDEA SimpleDiffViewer 式):三列 [左内容 | 中央行号槽 | 右内容] ── */

/** 双栏配对语义:双非空且文本不同 = 修改对(左红右绿同行),单侧 = 纯删/纯增。 */
type PairKind = "ctx" | "mod" | "del" | "add";
const pairKind = (left: PatchRow | null, right: PatchRow | null): PairKind =>
  left && right ? (left.text === right.text ? "ctx" : "mod") : left ? "del" : "add";

/** 色带 = 本侧行种类的经典淡染(与单栏同源变量)。 */
const SIDE_BAND: Record<string, string> = {
  del: "git-split-band-del",
  add: "git-split-band-add",
};
const bandFor = (row: PatchRow | null) => (row ? SIDE_BAND[row.kind] ?? "" : "");

/** 连续非 ctx pair 行 = 一个改动块(一条弧);返回每行的块 id 与首尾边标记。 */
type BlockTag = { id: number; edge: "first" | "mid" | "last" | "single" };
function blockMap(rows: SplitRow[]): (BlockTag | null)[] {
  const out: (BlockTag | null)[] = rows.map((r) =>
    r.kind === "pair" && pairKind(r.left, r.right) !== "ctx" ? { id: 0, edge: "mid" } : null,
  );
  let id = 0;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const start = i;
    while (i < out.length && out[i]) i++;
    const end = i - 1;
    for (let k = start; k <= end; k++)
      out[k] = { id, edge: k === start ? (k === end ? "single" : "first") : k === end ? "last" : "mid" };
    id++;
  }
  return out;
}

/** 槽内块弧 overlay:直译 IDEA DiffDrawUtil.makeCurve ——
 *  三次贝塞尔 (2,y0)→(w-2,y1),控制点 30%/70%。 */
function BlockArcs({ arcs, width }: { arcs: { y0: number; y1: number }[]; width: number }) {
  if (arcs.length === 0 || width <= 0) return null;
  return (
    <svg className="git-split-arcs" width={width} height="100%" aria-hidden>
      {arcs.map(({ y0, y1 }, i) => (
        <path
          key={i}
          d={`M 2 ${y0} C ${2 + (width - 2) * 0.3} ${y0}, ${2 + (width - 2) * 0.7} ${y1}, ${width - 2} ${y1}`}
          className="git-split-arc"
        />
      ))}
    </svg>
  );
}


/** 实测块首/尾槽段 y 范围(行高可变,wrap 下必须测量;RO 跟随容器)。 */
function useBlockArcs(containerRef: RefObject<HTMLElement | null>, blockCount: number) {
  const [state, setState] = useState<{ arcs: { y0: number; y1: number }[]; width: number }>({
    arcs: [],
    width: 0,
  });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const host = el.getBoundingClientRect();
      const byId = new Map<number, { y0: number; y1: number }>();
      let width = 0;
      for (const seg of el.querySelectorAll<HTMLElement>("[data-block-id]")) {
        const r = seg.getBoundingClientRect();
        const id = Number(seg.dataset.blockId);
        const acc = byId.get(id);
        byId.set(id, {
          y0: Math.min(acc?.y0 ?? r.top, r.top) - host.top,
          y1: Math.max(acc?.y1 ?? r.bottom, r.bottom) - host.top,
        });
        width = width || r.width;
      }
      setState({ arcs: [...byId.values()], width });
    };
    measure();
    const t = setTimeout(measure, 80); // 布局/字体稳定后复测
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [containerRef, blockCount]);
  return state;
}

/** 中央行号槽一格:旧行号居左、新行号居右;改动行旧号前加 ⤶ 钩,
 *  缺侧画空槽占位(⬚),改动行数字提亮。 */
function SlotGutter({ left, right, chg }: { left: PatchRow | null; right: PatchRow | null; chg?: boolean }) {
  return (
    <div className={`git-split-gutter-row ${chg ? "git-split-gutter-chg" : ""}`}>
      {left ? (
        <span>
          {chg && <span className="git-split-ghook">⤶</span>}
          {left.oldLine}
        </span>
      ) : (
        <span className="git-split-gslot-empty" aria-hidden />
      )}
      {right ? <span>{right.newLine}</span> : <span className="git-split-gslot-empty" aria-hidden />}
    </div>
  );
}

/** 占位行槽色:缺左 = 新增块占位(inserted 色),缺右 = 删除块占位(removed 色)。 */
const phClass = (kind: PairKind) =>
  !kind ? "" : kind === "add" ? "git-split-ph-add" : kind === "del" ? "git-split-ph-del" : "";

/** 换行态双栏:逐行三列 grid,行行对齐;块弧由槽列测量绘制。 */
function SplitRows({ rows, wrap }: { rows: SplitRow[]; wrap: boolean }) {
  const blocks = useMemo(() => blockMap(rows), [rows]);
  const containerRef = useRef<HTMLDivElement>(null);
  const { arcs, width } = useBlockArcs(containerRef, blocks.filter(Boolean).length);
  return (
    <div ref={containerRef} className="relative">
      <BlockArcs arcs={arcs} width={width} />
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
            block={blocks[i]}
            kind={pairKind(row.left, row.right)}
          />
        ),
      )}
    </div>
  );
}

function PairRow({
  row,
  wrap,
  block,
  kind,
}: {
  row: { left: PatchRow | null; right: PatchRow | null };
  wrap: boolean;
  block: BlockTag | null;
  kind: PairKind;
}) {
  const [dParts, iParts] = kind === "mod" ? wordDiff(row.left!.text, row.right!.text) : [null, null];
  const ph = kind === "ctx" ? "" : phClass(kind);
  return (
    /* 三列:左 1fr | 槽 auto | 右 1fr;同排行红绿对位,空侧留白。 */
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [content-visibility:auto] [contain-intrinsic-size:auto_1em]">
      <div className={`flex min-w-0 px-2 ${bandFor(row.left)}`}>
        {dParts ? (
          <WordContent parts={dParts} wrap={wrap} />
        ) : (
          <span className={wrap ? CONTENT_WRAP_CLS : CONTENT_NOWRAP_CLS}>{row.left?.text ?? ""}</span>
        )}
      </div>
      <div
        data-block-id={block?.id}
        data-block-edge={block?.edge}
        className={`border-x border-(color:--tmd-border) ${block ? "git-split-block-bg" : ""} ${ph}`}
      >
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
  const blocks = useMemo(() => blockMap(rows), [rows]);
  const { arcs, width } = useBlockArcs(midRef, blocks.filter(Boolean).length);
  const mid = (
    <div ref={midRef} className="relative h-full overflow-hidden border-x border-(color:--tmd-border)">
      <BlockArcs arcs={arcs} width={width} />
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div key={`h:${patchRowKey(row.row)}`} />
        ) : (
          <div
            key={`g:${patchRowKey(row.left ?? row.right!)}`}
            data-block-id={blocks[i]?.id}
            data-block-edge={blocks[i]?.edge}
            className={`git-split-block-bg ${phClass(pairKind(row.left, row.right))}`}
          >
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
