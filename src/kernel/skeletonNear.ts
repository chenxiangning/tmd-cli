/**
 * 字母骨架近似判定(有界 Levenshtein ≤2,超限早退)—— activityWatch 粒度换字
 * 继承持轮资格的判据:计时单位换字(「59s」→「1m」骨架仅差一个字母)= 同一家具流
 * 换形;完工换装(工作页脚 ↔ idle 页脚)距离远超,不近似。纯函数,独立可测。
 */
export function skeletonNear(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    if (Math.min(...row) > 2) return false;
    prev = row;
  }
  return prev[b.length] <= 2;
}
