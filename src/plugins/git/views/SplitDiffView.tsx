/**
 * 双栏 diff(split)自绘渲染 —— 中缝连接带(JetBrains 形):左内容 | 旧号 | 新号 | 右内容。
 *
 * - 对位:buildSplitRows 把 ctx 同行、del 块 × add 块 zip 配对,缺侧留白(浅染空带);
 * - 行号槽居中缝两侧(JetBrains 排布):muted 右对齐不可选;改动行(mod/del/add)双号格
 *   发丝透明,两侧色带贯通中缝成横带;wrap 随行渲染,nowrap 为独立纵同步栈(行号不横滚);
 * - 词级标注:mod 对差异 token 实色深染块(深行底一档,wordDiff);
 * - 独立横向滚动条(关换行时):左右内容列各为独立 overflow-auto 滚动面,
 *   纵向 scrollTop 四面(左/左槽/右槽/右)镜像同步;
 * - 行高四面同源:nowrap 态四列是四个独立行栈,WebKit 下各栈行盒高度有亚像素差,
 *   逐行累积成整行错位(全文单 hunk 时最显)——左内容栈为基准实测行高(盒高;行外
 *   边距四面同类同值,折叠量一致),其余三栈逐行 pin 同值,引擎差异归零。
 */
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { buildSplitRows, patchRowKey, type PatchRow, type SplitRow } from "./patchModel";
import { lnoCols, wordDiff, type WordDiffPair, type WordPart } from "./wordDiff";

/* 正文格:wrap 换行 / nowrap 撑出滚动面。 */
const CONTENT_WRAP_CLS = "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2";
const CONTENT_NOWRAP_CLS = "shrink-0 whitespace-pre pl-2";

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
/** hunk 头 / meta 行通栏样式。行高多面一致靠 min-h-[1.25em](空占位无文字也
 *  与带字行等高;1.25em = pre 的 leading-tight 行高,不用 lh 单位——老
 *  WebKit(Tauri 系统 WebView)不支持,静默塌行)。halves 模式另用 *_NW:
 *  whitespace-pre 恒单行,超长头随该列横滚,不撑高错位。 */
const HEADER_CLS: Record<"hunk" | "meta", string> = {
  hunk: "my-1 min-h-[1.25em] border-y border-(color:--tmd-border) bg-(color:--tmd-bg-hover)/40 px-1 text-[0.625rem] text-(--tmd-accent)",
  meta: "min-h-[1.25em] px-1 italic text-(--tmd-fg-faint)",
};
const HEADER_NW_CLS: Record<"hunk" | "meta", string> = {
  hunk: `${HEADER_CLS.hunk} whitespace-pre`,
  meta: `${HEADER_CLS.meta} whitespace-pre`,
};

/** 双栏配对语义:双非空且文本不同 = 修改对(左红右绿同行);单侧 = 纯删/纯增。 */
type PairKind = "ctx" | "mod" | "del" | "add";
const pairKind = (left: PatchRow | null, right: PatchRow | null): PairKind =>
  left && right ? (left.text === right.text ? "ctx" : "mod") : left ? "del" : "add";

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
const sideBand = (self: PatchRow | null, other: PatchRow | null): string =>
  self ? (SIDE_BAND[self.kind] ?? "") : other ? (EMPTY_BAND[other.kind] ?? "") : "";

/** 行号格:中缝两侧单号槽(JetBrains 排布);缺侧空号同色带铺底;旧号格补左缘发丝
 *  (git-split-lno-old),改动行 seam 类发丝全透明(pairKind 判定,ctx 之外皆改动)。 */
function LineNo({
  row,
  other,
  isLeft,
  style,
}: {
  row: PatchRow | null;
  other: PatchRow | null;
  isLeft: boolean;
  style?: CSSProperties;
}) {
  const n = row ? (isLeft ? row.oldLine : row.newLine) : null;
  const seam = pairKind(row, other) !== "ctx";
  return (
    <div style={style} className={`git-split-lno ${isLeft ? "git-split-lno-old" : ""} ${seam ? "git-split-lno-seam" : ""} ${sideBand(row, other)}`}>
      {n ?? ""}
    </div>
  );
}


/** mod 对词级标注预计算:随 rows 换代,每对同一 DP 只跑一遍(wrap/nowrap 两态共用)。 */
function useWordParts(rows: SplitRow[]) {
  return useMemo(
    () =>
      rows.map((row) =>
        row.kind === "pair" && pairKind(row.left, row.right) === "mod" ? wordDiff(row.left!.text, row.right!.text) : null,
      ),
    [rows],
  );
}

/* ── 换行态:单滚动面,逐行四列 grid ── */

function SplitGrid({ rows, cols }: { rows: SplitRow[]; cols: string }) {
  const wordParts = useWordParts(rows);
  return (
    <>
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div key={patchRowKey(row.row)} className={row.row.kind === "hunk" ? HEADER_CLS.hunk : HEADER_CLS.meta}>
            {row.row.text}
          </div>
        ) : (
          <GridPairRow
            key={`${row.left ? patchRowKey(row.left) : "e"}|${row.right ? patchRowKey(row.right) : "e"}`}
            row={row}
            cols={cols}
            parts={wordParts[i]}
          />
        ),
      )}
    </>
  );
}

function GridPairRow({ row, cols, parts }: { row: Extract<SplitRow, { kind: "pair" }>; cols: string; parts: WordDiffPair | null }) {
  const [dParts, iParts] = parts ?? [null, null];
  return (
    <div className="grid [content-visibility:auto] [contain-intrinsic-size:auto_1em]" style={{ gridTemplateColumns: cols }}>
      <div className={`flex min-w-0 pr-2 ${sideBand(row.left, row.right)}`}>
        {dParts ? (
          <WordContent parts={dParts} wrap={true} />
        ) : (
          <span className={CONTENT_WRAP_CLS}>{row.left?.text ?? ""}</span>
        )}
      </div>
      <LineNo row={row.left} other={row.right} isLeft={true} />
      <LineNo row={row.right} other={row.left} isLeft={false} />
      <div className={`flex min-w-0 pr-2 ${sideBand(row.right, row.left)}`}>
        {iParts ? (
          <WordContent parts={iParts} wrap={true} />
        ) : (
          <span className={CONTENT_WRAP_CLS}>{row.right?.text ?? ""}</span>
        )}
      </div>
    </div>
  );
}

/* ── 关闭换行:左右独立横向滚动面 + 双号槽栈,纵向四面同步 ── */

/** 左内容栈行盒高实测(getBoundingClientRect,亚像素保真):其余三栈逐行 pin
 *  同值;行外边距(header my-1)四面同类同值,折叠量一致,只 pin 盒高即四面同位。 */
function useRowHeights(innerRef: RefObject<HTMLDivElement | null>, rows: SplitRow[]): number[] | null {
  const [heights, setHeights] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => {
      const hs = Array.from(el.children, (c) => (c as HTMLElement).getBoundingClientRect().height);
      setHeights((prev) => (prev && prev.length === hs.length && prev.every((v, j) => v === hs[j]) ? prev : hs));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [innerRef, rows]);
  return heights;
}

function SplitHalves({ rows, cols }: { rows: SplitRow[]; cols: string }) {
  const wordParts = useWordParts(rows);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLDivElement>(null);
  const grRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  /* ponytail: rAF 解锁窗内若镜像 pane 的 scroll 事件迟到,会多写一次同值
     scrollTop(无振荡、视觉无感);换 scrollend/写前比值可根治,不值当。 */
  const mirror =
    (src: RefObject<HTMLDivElement | null>, dst: RefObject<HTMLDivElement | null>[]) => () => {
      if (syncingRef.current || !src.current) return;
      syncingRef.current = true;
      for (const d of dst) if (d.current) d.current.scrollTop = src.current.scrollTop;
      requestAnimationFrame(() => {
        syncingRef.current = false;
      });
    };
  /* 中槽/右槽/右内容三栈逐行 pin 左内容栈实测高:同值同位,跨引擎零累积错位。 */
  const leftInnerRef = useRef<HTMLDivElement>(null);
  const rowHeights = useRowHeights(leftInnerRef, rows);
  const pin = (i: number) => (rowHeights ? { height: rowHeights[i] } : undefined);
  /* 一面内容列:header 通栏单行;pair 行取本侧,缺侧等高留白(浅染空带)。
     行色带要铺满横向滚动全宽 → 滚动面内衬 w-max min-w-full。 */
  const side = (isLeft: boolean) => {
    const me = isLeft ? leftRef : rightRef;
    const targets = isLeft ? [rightRef, glRef, grRef] : [leftRef, glRef, grRef];
    return (
      <div ref={me} onScroll={mirror(me, targets)} className="h-full min-w-0 overflow-auto">
        <div ref={isLeft ? leftInnerRef : undefined} className="w-max min-w-full pr-2">
          {rows.map((row, i) => {
            if (row.kind === "header")
              return (
                <div
                  key={`h:${patchRowKey(row.row)}`}
                  className={row.row.kind === "hunk" ? HEADER_NW_CLS.hunk : HEADER_NW_CLS.meta}
                >
                  {row.row.text}
                </div>
              );
            const self = isLeft ? row.left : row.right;
            const other = isLeft ? row.right : row.left;
            const band = sideBand(self, other);
            if (!self)
              return (
                <div key={`e:${patchRowKey(other!)}`} style={isLeft ? undefined : pin(i)} className={`min-h-[1.25em] ${band}`} aria-hidden />
              );
            const pair = wordParts[i];
            const parts = pair ? (isLeft ? pair[0] : pair[1]) : null;
            return (
              <div key={patchRowKey(self)} style={isLeft ? undefined : pin(i)} className={`min-h-[1.25em] ${band}`}>
                {parts ? (
                  <WordContent parts={parts} wrap={false} />
                ) : (
                  <span className={CONTENT_NOWRAP_CLS}>{self.text}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  /* 一面行号槽栈:不横滚(overflow-hidden),header 空行与内容栈同高同外边距。 */
  const gutter = (isLeft: boolean) => (
    <div ref={isLeft ? glRef : grRef} className="h-full overflow-hidden">
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div
            key={`h:${patchRowKey(row.row)}`}
            style={pin(i)}
            className={`git-split-lno ${isLeft ? "git-split-lno-old" : ""} ${row.row.kind === "hunk" ? HEADER_CLS.hunk : HEADER_CLS.meta}`}
            aria-hidden
          />
        ) : (
          <LineNo
            key={`g:${patchRowKey(row.left ?? row.right!)}`}
            style={pin(i)}
            row={isLeft ? row.left : row.right}
            other={isLeft ? row.right : row.left}
            isLeft={isLeft}
          />
        ),
      )}
    </div>
  );
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: cols }}>
      {side(true)}
      {gutter(true)}
      {gutter(false)}
      {side(false)}
    </div>
  );
}
/** 双栏入口:wrap 开 = 单滚动面逐行 grid;wrap 关 = 左右独立横向滚动面。
 *  注意:nowrap 态固定 h-full(横向滚动条归两半各自、纵向四面同步需要
 *  确定高度),调用方传入的 className 尺寸类在 nowrap 下被忽略。 */
export function SplitDiffView({ rows, wrap, className }: { rows: PatchRow[]; wrap: boolean; className: string }) {
  const splitRows = useMemo(() => buildSplitRows(rows), [rows]);
  const cols = useMemo(() => lnoCols(splitRows), [splitRows]);
  if (!wrap) {
    return (
      <pre className="h-full overflow-hidden py-1 font-mono text-[0.6875rem] leading-tight">
        <SplitHalves rows={splitRows} cols={cols} />
      </pre>
    );
  }
  return (
    <pre className={`${className} overflow-auto py-1 font-mono text-[0.6875rem] leading-tight`}>
      <SplitGrid rows={splitRows} cols={cols} />
    </pre>
  );
}
