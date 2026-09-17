/**
 * 字母骨架近似判定(有界 Levenshtein ≤2,超限早退)—— activityWatch 粒度换字
 * 继承持轮资格的判据:计时单位换字(「59s」→「1m」骨架仅差一个字母)= 同一家具流
 * 换形。注意:工作页脚 ↔ 空闲页脚的换装距离**并非**恒远超 —— omp 实采(09-18)
 * `⠧ 13s > ◉…` 与 `π > ◉…` 骨架仅差 1,链继承曾把空闲页脚加冕为 ticker 致永挂;
 * 防线在闸 4d(空闲自证帧不进分类器),不在本函数。纯函数,独立可测。
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
