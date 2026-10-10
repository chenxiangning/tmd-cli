/**
 * 双栏 diff(split)自绘渲染 —— 中缝连接带(JetBrains 形):左内容 | 旧号 | 新号 | 右内容。
 * 全文态未改动段折叠 = fold 为真时段内 ctx 行整体隐去(展开入口在头部工具条,
 * 见 DiffModeToggle);lang = Prism 语言 id,正文格静态上色(splitCells.CodeSpan)。
 */
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { buildSplitRows, patchRowKey, planFolds, visibleSplitRows, type PatchRow, type SplitRow } from "./patchModel";
import { lnoCols } from "./wordDiff";
import { GridPairRow, LineNo, useWordParts, WordContent, CodeSpan } from "./splitCells";
import { CONTENT_NOWRAP_CLS, HEADER_CLS, HEADER_NW_CLS, sideBand } from "./splitCls";

/** 行盒跳屏渲染(对齐 PatchLines.tsx unified 态的 content-visibility 方案):
 *  contain-intrinsic-size 回落取 1.25em —— 与本件 min-h-[1.25em]/leading-tight
 *  实测行高同值,未渲染行估高不偏离,nowrap 四栈逐行 pin 的测量不被扰动。 */
const CV_ROW = "[content-visibility:auto] [contain-intrinsic-size:auto_1.25em]";


/* ── 换行态:单滚动面,逐行四列 grid ── */

function SplitGrid({
  items,
  cols,
  lang,
}: {
  items: SplitRow[];
  cols: string;
  lang: string;
}) {
  const wordParts = useWordParts(items);
  return (
    <>
      {items.map((row, i) =>
        row.kind === "header" ? (
          /* hunk 头不加 CV(unified 态 hunk 早返回同款);meta 行对齐 unified 加。 */
          <div
            key={patchRowKey(row.row)}
            className={row.row.kind === "hunk" ? HEADER_CLS.hunk : `${CV_ROW} ${HEADER_CLS.meta}`}
          >
            {row.row.text}
          </div>
        ) : (
          <GridPairRow
            key={`${row.left ? patchRowKey(row.left) : "e"}|${row.right ? patchRowKey(row.right) : "e"}`}
            row={row}
            cols={cols}
            parts={wordParts[i]}
            lang={lang}
          />
        ),
      )}
    </>
  );
}

/* ── 关闭换行:左右独立横向滚动面 + 双号槽栈,纵向四面同步 ── */

/** 左内容栈行盒高实测(getBoundingClientRect,亚像素保真):其余三栈逐行 pin
 *  同值;行外边距(header my-1)四面同类同值,只 pin 盒高即四面同位。 */
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

function SplitHalves({
  items,
  cols,
  lang,
}: {
  items: SplitRow[];
  cols: string;
  lang: string;
}) {
  const wordParts = useWordParts(items);
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
  const rowHeights = useRowHeights(leftInnerRef, items);
  const pin = (i: number) => (rowHeights ? { height: rowHeights[i] } : undefined);
  /* 一面内容列:header 通栏单行;pair 行取本侧,缺侧等高留白(浅染空带)。
     行色带要铺满横向滚动全宽 → 滚动面内衬 w-max min-w-full。 */
  const side = (isLeft: boolean) => {
    const me = isLeft ? leftRef : rightRef;
    const targets = isLeft ? [rightRef, glRef, grRef] : [leftRef, glRef, grRef];
    return (
      <div ref={me} onScroll={mirror(me, targets)} className="h-full min-w-0 overflow-auto [container-type:inline-size]">
        <div ref={isLeft ? leftInnerRef : undefined} className="w-max min-w-full pr-2">
          {items.map((row, i) => {
            if (row.kind === "header")
              return (
                <div
                  key={`h:${patchRowKey(row.row)}`}
                  className={row.row.kind === "hunk" ? HEADER_NW_CLS.hunk : `${CV_ROW} ${HEADER_NW_CLS.meta}`}
                >
                  {row.row.text}
                </div>
              );
            const self = isLeft ? row.left : row.right;
            const other = isLeft ? row.right : row.left;
            const band = sideBand(self, other);
            if (!self)
              return (
                <div key={`e:${patchRowKey(other!)}`} style={isLeft ? undefined : pin(i)} className={`min-h-[1.25em] ${CV_ROW} ${band}`} aria-hidden />
              );
            const pair = wordParts[i];
            const parts = pair ? (isLeft ? pair[0] : pair[1]) : null;
            return (
              <div key={patchRowKey(self)} style={isLeft ? undefined : pin(i)} className={`min-h-[1.25em] ${CV_ROW} ${band}`}>
                {parts ? (
                  <WordContent parts={parts} wrap={false} lang={lang} />
                ) : (
                  <CodeSpan text={self.text} lang={lang} className={CONTENT_NOWRAP_CLS} />
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
      {items.map((row, i) =>
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
export function SplitDiffView({
  rows,
  wrap,
  className,
  fold,
  lang = "",
}: {
  rows: PatchRow[];
  wrap: boolean;
  className: string;
  /** 全文态未改动段折叠:段内 ctx 行隐去(缺省不折叠;入口在头部工具条)。 */
  fold?: boolean;
  /** Prism 语言 id(空串 = 不上色)。 */
  lang?: string;
}) {
  const splitRows = useMemo(() => buildSplitRows(rows), [rows]);
  const cols = useMemo(() => lnoCols(splitRows), [splitRows]);
  const runs = useMemo(() => (fold ? planFolds(splitRows) : null), [fold, splitRows]);
  const items = useMemo(() => visibleSplitRows(splitRows, runs), [splitRows, runs]);
  if (!wrap) {
    return (
      <pre className="h-full overflow-hidden py-1 font-mono text-xs leading-tight">
        <SplitHalves items={items} cols={cols} lang={lang} />
      </pre>
    );
  }
  return (
    <pre className={`${className} overflow-auto py-1 font-mono text-xs leading-tight`}>
      <SplitGrid items={items} cols={cols} lang={lang} />
    </pre>
  );
}
