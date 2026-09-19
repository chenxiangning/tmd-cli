/**
 * 词级 diff(双栏「修改对」行内标注)—— 行内 token LCS。
 * 仅 SplitDiffView 消费:修改对左右两格按 token 对齐,差异段实色深染块(旧下划线样式已删)。
 * 超限(n*m > 20000)退化为整行标注,防大行卡顿。
 */

export type WordPart = { text: string; tag?: "ins" | "del" };

/** 修改对左右两份词级标注(wordDiff 返回契约,SplitDiffView 两态共用)。 */
export type WordDiffPair = [WordPart[], WordPart[]];

/* u 标志:[^\w\s] 按码点整配,星面字符(emoji/CJK 扩展 B)不被按码元劈成孤立代理项
 * (劈半的公共 emoji 会渲染成 U+FFFD 替换符,2026-09-15 评审)。 */
const tokenRe = /[\w-]+|\s+|[^\w\s]/gu;
const MAX_LDP_CELLS = 20000;

export function wordDiff(a: string, b: string): WordDiffPair {
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
        push(A[i], undefined);
        i++;
        j++;
      } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) {
        /* A[i] 是删除 token:只左栏渲染;右栏同步跳过(绝不渲染对侧文本)。 */
        if (side === 0) push(A[i], "del");
        i++;
      } else {
        /* B[j] 是插入 token:只右栏渲染;左栏同步跳过。 */
        if (side === 1) push(B[j], "ins");
        j++;
      }
    }
    while (i < n) {
      if (side === 0) push(A[i], "del");
      i++;
    }
    while (j < m) {
      if (side === 1) push(B[j], "ins");
      j++;
    }
    return out;
  };
  return [parts(0), parts(1)];
}

/** 行号槽列轨:按两侧最大行号位数定 ch 宽(左右槽恒同宽 = 两边内容列镜像对齐;
 *  显式列轨也消掉 content-visibility 离屏行不计宽导致的槽宽抖动)。
 *  参数取结构最小形状(SplitDiffView 的 SplitRow[] 结构子类型直传,免循环 import)。 */
export function lnoCols(
  rows: { kind: string; left?: { oldLine?: number | null } | null; right?: { newLine?: number | null } | null }[],
): string {
  let digits = 2;
  for (const r of rows)
    if (r.kind === "pair") {
      if (r.left?.oldLine) digits = Math.max(digits, String(r.left.oldLine).length);
      if (r.right?.newLine) digits = Math.max(digits, String(r.right.newLine).length);
    }
  /* +2ch:槽内 padding(12px)与双发丝吃掉 ~7px,+1ch 余量是假的(右对齐数字
   * 会向邻格溢出 ~7px,现靠邻格 pr-2 恰好兜住)。 */
  const w = `${digits + 2}ch`;
  return `minmax(0,1fr) ${w} ${w} minmax(0,1fr)`;
}

