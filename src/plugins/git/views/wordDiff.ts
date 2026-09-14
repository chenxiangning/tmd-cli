/**
 * 词级 diff(双栏「修改对」行内标注)—— 行内 token LCS。
 * 仅 SplitDiffView 消费:修改对左右两格按 token 对齐,差异段下划线标注(非色块)。
 * 超限(n*m > 20000)退化为整行标注,防大行卡顿。
 */

export type WordPart = { text: string; tag?: "ins" | "del" };


const tokenRe = /[\w-]+|\s+|[^\w\s]/g;
const MAX_LDP_CELLS = 20000;

export function wordDiff(a: string, b: string): [WordPart[], WordPart[]] {
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

