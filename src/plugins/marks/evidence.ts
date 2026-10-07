/**
 * 标注存证派生(W2 存证链)—— 「已生效」徽章与参与轮次,纯前端 join,零写路径。
 *
 * 数据链:锚点 marksRefs(账本,发送时点冻结)× 批 patch(diffCache 懒取)
 * × 批状态(reverted 排除)。marks sidecar 完全不动 —— 存证真相源唯一(checkpoints 账本)。
 *
 * 相交口径 = 批 patch 的**老侧 hunk 区间**(批前空间)∩ 标记冻结区间(发送时点空间):
 * 「同空间对齐」只对**首个携带批**严格成立 —— 后续批的老侧已是被早前批改写后的
 * 演化空间,标记上方有插入/删除时系统性错位 → 假 none(漏报,方向与宁漏勿串一致)。
 * new-range 是批后空间,首批判定也会吞假阳性,不用。
 * A/D 文件不参与:A 与标记先行存在矛盾;D 走标记 lost 语义(patch 由调用方不装入)。
 *
 * ponytail: 行号级近似天花板 —— 批内 hunk 相邻交叠边界误差 + 跨批行号漂移;
 * 内容级精确比对(fingerprint 重放 / 按先前批 patch 平移冻结区间)不做,徽章语义
 * 「参与改写轮次」够用,升级路径 = evidence 按 TurnFile 前后像重放标记行哈希。
 * 跨会话历史批(已退出会话)不追:需 cwd 级账本枚举面,真实痛点再上;
 * 当前 join 域 = 调用方传入的活会话批清单。
 */

/** unified diff 单 hunk 头解析出的老侧区间(1 基闭区间)。 */
export function parseOldRanges(patch: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+/gm)) {
    const start = Number(m[1]);
    const len = m[2] === undefined ? 1 : Number(m[2]); // 省略长度 = 单行
    if (len > 0) out.push([start, start + len - 1]); // len=0(纯插入锚点)无老侧行,不产区间
  }
  return out;
}

/** 闭区间相交(含相切边界:改写紧邻标记首尾行算命中)。 */
export function intersects(
  a: readonly [number, number],
  b: readonly [number, number],
): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** 参与轮次的判定值(标注卡轮次片与徽章共用)。 */
export type RoundVerdict = "eff" | "revt" | "none" | "open";

/** join 输入:单批判定面。carried = 锚点 marksRefs 含该标记;
 *  patch = 该标记路径的 M 类 patch 文本(A/D/二进制/未取到 = null)。 */
export interface RoundInput {
  open: boolean;
  reverted: boolean;
  carried: boolean;
  patch: string | null;
}

/** 单轮判定:未携带 = null(不进参与轮次);携带则三值(open = 进行中,封口后判定)。 */
export function verdictFor(
  mark: { startLine: number; endLine: number },
  round: RoundInput,
): RoundVerdict | null {
  if (!round.carried) return null;
  if (round.open) return "open";
  if (!round.patch) return "none";
  const hit = parseOldRanges(round.patch).some((h) => intersects(h, [mark.startLine, mark.endLine]));
  if (!hit) return "none";
  return round.reverted ? "revt" : "eff";
}
