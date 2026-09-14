/**
 * 双栏 diff(split)自绘渲染 —— 左内容 | 中央行号槽 | 右内容。
 *
 * - 对位:buildSplitRows 把 ctx 同行、del 块 × add 块 zip 配对,缺侧留白;
 * - 独立横向滚动条(关换行时):左右内容列各为独立 overflow-auto 滚动面,
 *   纵向 scrollTop 三面(左/槽/右)镜像同步(nowrap 行高恒单行,三面行数一致);
 * - 改动块识别框:块行在中央槽画 accent 括号框(槽列不随横滚,任何滚动位
 *   都可见),块首/块尾在两个内容列拉 accent 横线贯穿;缺侧占位行涂类型色块;
 * - 词级标注:mod 对 token 差异下划线(见 wordDiff.tsx)。
 */
import { useMemo, useRef, type RefObject } from "react";
import { buildSplitRows, patchRowKey, type PatchRow, type SplitRow } from "./patchModel";
import { wordDiff, type WordPart } from "./wordDiff";

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
/** hunk 头 / meta 行通栏样式。行高三面一致靠 min-h-[1.25em](空占位无文字也
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

/** 色带 = 本侧行种类的经典淡染(与单栏同源变量)。 */
const SIDE_BAND: Record<string, string> = {
  del: "git-split-band-del",
  add: "git-split-band-add",
};
const bandFor = (row: PatchRow | null) => (row ? SIDE_BAND[row.kind] ?? "" : "");

/** 连续非 ctx pair 行 = 一个改动块;返回每行的首尾边标记(块框/横线绘制用)。 */
type BlockTag = { edge: "first" | "mid" | "last" | "single" } | null;
function blockMap(rows: SplitRow[]): BlockTag[] {
  const out: BlockTag[] = rows.map((r) =>
    r.kind === "pair" && pairKind(r.left, r.right) !== "ctx" ? { edge: "mid" } : null,
  );
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    const start = i;
    while (i < out.length && out[i]) i++;
    const end = i - 1;
    for (let k = start; k <= end; k++)
      out[k] = { edge: k === start ? (k === end ? "single" : "first") : k === end ? "last" : "mid" };
  }
  return out;
}
/** 槽列块底 class:accent 淡染,与内容列色带同块同范围。 */
const frameCls = (tag: BlockTag): string => (tag ? "git-split-block-bg" : "");

/** 块首/块尾横线 class:三面(左内容/槽/右内容)同值同位,横线贯通不割裂。 */
function lineCls(tag: BlockTag): string {
  if (!tag) return "";
  const top = tag.edge === "first" || tag.edge === "single";
  const bot = tag.edge === "last" || tag.edge === "single";
  return `${top ? "git-split-bd-top " : ""}${bot ? "git-split-bd-bot" : ""}`.trim();
}

/** 占位行槽色块:缺左 = 新增块占位(inserted),缺右 = 删除块占位(removed)。 */
const phClass = (kind: PairKind) =>
  kind === "add" ? "git-split-ph-add" : kind === "del" ? "git-split-ph-del" : "";

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

/* ── 换行态:单滚动面,逐行三列 grid ── */

function SplitGrid({ rows }: { rows: SplitRow[] }) {
  const blocks = useMemo(() => blockMap(rows), [rows]);
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
            tag={blocks[i]}
          />
        ),
      )}
    </>
  );
}

function GridPairRow({ row, tag }: { row: Extract<SplitRow, { kind: "pair" }>; tag: BlockTag }) {
  const kind = pairKind(row.left, row.right);
  const [dParts, iParts] = kind === "mod" ? wordDiff(row.left!.text, row.right!.text) : [null, null];
  const bd = lineCls(tag);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [content-visibility:auto] [contain-intrinsic-size:auto_1em]">
      <div className={`flex min-w-0 px-2 ${bandFor(row.left)} ${bd}`}>
        {dParts ? (
          <WordContent parts={dParts} wrap={true} />
        ) : (
          <span className={CONTENT_WRAP_CLS}>{row.left?.text ?? ""}</span>
        )}
      </div>
      <div className={`git-split-gutter-col ${lineCls(tag)} ${frameCls(tag)} ${phClass(kind)}`}>
        <SlotGutter left={row.left} right={row.right} chg={kind !== "ctx"} />
      </div>
      <div className={`flex min-w-0 px-2 ${bandFor(row.right)} ${bd}`}>
        {iParts ? (
          <WordContent parts={iParts} wrap={true} />
        ) : (
          <span className={CONTENT_WRAP_CLS}>{row.right?.text ?? ""}</span>
        )}
      </div>
    </div>
  );
}

/* ── 关闭换行:左右独立横向滚动面 + 中央槽,纵向三面同步 ── */

function SplitHalves({ rows }: { rows: SplitRow[] }) {
  /* mod 对词级标注一次算两份:side() 左右各渲染一遍,逐侧现算 = 同一 DP 跑两遍
   * (2026-09-15 评审);预计算随 rows 换代。 */
  const wordParts = useMemo(
    () =>
      rows.map((row) =>
        row.kind === "pair" && pairKind(row.left, row.right) === "mod"
          ? wordDiff(row.left!.text, row.right!.text)
          : null,
      ),
    [rows],
  );
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
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
  const blocks = useMemo(() => blockMap(rows), [rows]);
  /* 一面内容列:header 通栏单行;pair 行取本侧,缺侧等高留白(带块横线)。
     行色带/横线要铺满横向滚动全宽 → 滚动面内衬 w-max min-w-full。 */
  const side = (isLeft: boolean) => {
    const me = isLeft ? leftRef : rightRef;
    const targets = isLeft ? [rightRef, midRef] : [leftRef, midRef];
    return (
      <div ref={me} onScroll={mirror(me, targets)} className="h-full min-w-0 overflow-auto">
        <div className="w-max min-w-full px-2">
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
            const bd = lineCls(blocks[i]);
            if (!self)
              return (
                <div key={`e:${patchRowKey((isLeft ? row.right : row.left)!)}`} className={`min-h-[1.25em] ${bd}`} aria-hidden />
              );
            const pair = wordParts[i];
            const parts = pair ? (isLeft ? pair[0] : pair[1]) : null;
            return (
              <div key={patchRowKey(self)} className={`min-h-[1.25em] ${bandFor(self)} ${bd}`}>
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
  /* 中央槽列:不横滚(overflow-hidden),块括号框恒可见;header 空行与两侧同高。 */
  const mid = (
    <div ref={midRef} className="h-full overflow-hidden">
      {rows.map((row, i) =>
        row.kind === "header" ? (
          <div key={`h:${patchRowKey(row.row)}`} className={row.row.kind === "hunk" ? HEADER_CLS.hunk : HEADER_CLS.meta} aria-hidden />
        ) : (
          <div key={`g:${patchRowKey(row.left ?? row.right!)}`} className={`git-split-gutter-col ${lineCls(blocks[i])} ${frameCls(blocks[i])} ${phClass(pairKind(row.left, row.right))}`}>
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
/** 双栏入口:wrap 开 = 单滚动面逐行 grid;wrap 关 = 左右独立横向滚动面。
 *  注意:nowrap 态固定 h-full(横向滚动条归两半各自、纵向三面同步需要
 *  确定高度),调用方传入的 className 尺寸类在 nowrap 下被忽略。 */
export function SplitDiffView({ rows, wrap, className }: { rows: PatchRow[]; wrap: boolean; className: string }) {
  const splitRows = useMemo(() => buildSplitRows(rows), [rows]);
  if (!wrap) {
    return (
      <pre className="h-full overflow-hidden py-1 font-mono text-[0.6875rem] leading-tight">
        <SplitHalves rows={splitRows} />
      </pre>
    );
  }
  return (
    <pre className={`${className} overflow-auto py-1 font-mono text-[0.6875rem] leading-tight`}>
      <SplitGrid rows={splitRows} />
    </pre>
  );
}
