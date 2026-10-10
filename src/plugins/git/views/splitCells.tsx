/**
 * 双栏 diff 共享组件 —— 正文格(词级标注容器)、mod 对行、行号槽、词级标注
 * 预计算钩。组件与钩出此;类名表在 splitCls.ts(组件文件不放非组件导出),
 * 行语义在 patchModel.ts。SplitDiffView 的 grid/halves 两渲染器与单栏
 * PatchLines 共用 CodeSpan/WordContent(lang = Prism 语言 id,空串不上色)。
 */
import { useMemo, type CSSProperties } from "react";
import { pairKind, type PatchRow, type SplitRow } from "./patchModel";
import { wordDiff, type WordDiffPair, type WordPart } from "./wordDiff";
import { highlightLine } from "@kernel/syntaxHighlight";
import { CONTENT_WRAP_CLS, sideBand } from "./splitCls";

/** 静态语法上色的正文格:highlightLine 出转义 + token span 的 HTML(LRU 缓存),
 *  lang 为空串时等于纯转义。三处调用点(单栏行/双栏 grid/halves)锁定同款行为。 */
export function CodeSpan({ text, lang, className }: { text: string; lang: string; className: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: highlightLine(text, lang || null) }} />;
}

export function WordContent({ parts, wrap, lang }: { parts: WordPart[]; wrap: boolean; lang: string }) {
  return (
    <span className={wrap ? "min-w-0 flex-1 whitespace-pre-wrap break-all pl-2" : "shrink-0 whitespace-pre pl-2"}>
      {parts.map((p, i) =>
        p.tag ? (
          <span
            key={i}
            className={p.tag === "ins" ? "git-split-word git-split-word-ins" : "git-split-word git-split-word-del"}
            dangerouslySetInnerHTML={{ __html: highlightLine(p.text, lang || null) }}
          />
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: highlightLine(p.text, lang || null) }} />
        ),
      )}
    </span>
  );
}

/** 行号格:中缝两侧单号槽(JetBrains 排布);缺侧空号同色带铺底;旧号格补左缘发丝
 *  (git-split-lno-old),改动行 seam 类发丝全透明(pairKind 判定,ctx 之外皆改动)。 */
export function LineNo({
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

/** mod 对 / 纯删 / 纯增 / ctx 行(wrap 态):逐行四列 grid,本侧色带,词级标注。 */
export function GridPairRow({
  row,
  cols,
  parts,
  lang,
}: {
  row: Extract<SplitRow, { kind: "pair" }>;
  cols: string;
  parts: WordDiffPair | null;
  lang: string;
}) {
  const [dParts, iParts] = parts ?? [null, null];
  return (
    <div className="grid [content-visibility:auto] [contain-intrinsic-size:auto_1em]" style={{ gridTemplateColumns: cols }}>
      <div className={`flex min-w-0 pr-2 ${sideBand(row.left, row.right)}`}>
        {dParts ? (
          <WordContent parts={dParts} wrap={true} lang={lang} />
        ) : (
          <CodeSpan text={row.left?.text ?? ""} lang={lang} className={CONTENT_WRAP_CLS} />
        )}
      </div>
      <LineNo row={row.left} other={row.right} isLeft={true} />
      <LineNo row={row.right} other={row.left} isLeft={false} />
      <div className={`flex min-w-0 pr-2 ${sideBand(row.right, row.left)}`}>
        {iParts ? (
          <WordContent parts={iParts} wrap={true} lang={lang} />
        ) : (
          <CodeSpan text={row.right?.text ?? ""} lang={lang} className={CONTENT_WRAP_CLS} />
        )}
      </div>
    </div>
  );
}

/** mod 对词级标注预计算:随 rows 换代,每对同一 DP 只跑一遍(wrap/nowrap 两态共用)。 */
export function useWordParts(rows: SplitRow[]) {
  return useMemo(
    () =>
      rows.map((row) =>
        row.kind === "pair" && pairKind(row.left, row.right) === "mod" ? wordDiff(row.left!.text, row.right!.text) : null,
      ),
    [rows],
  );
}
