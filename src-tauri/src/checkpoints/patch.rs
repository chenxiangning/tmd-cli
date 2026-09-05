//! 行级 patch 精准手术 —— 共改文件(并行会话先后写同一文件)的 diff 擦除与重放。
//!
//! 全文件回退的「内容已变」保护闸在共改场景过于一刀切:另一会话写进同一文件
//! 的内容会被连坐。本模块把「本批改动」表示为 base→target 的行级补丁,以精确
//! 上下文匹配应用到 ours(live)上 —— 上下文命中的 hunk 精准擦除/重放,命不中
//! 或命中不唯一(他人在同区域改过 / 窗口内存在重复块)返回 None,调用方按冲突
//! 跳过,绝不静默覆盖。
//!
//! 算法:统一 patch(上下文 3 行)。hunk 按 base 位置排序,上下文重叠的相邻
//! hunk 合并;应用时在期望位置附近(±250 行)找 old 块的唯一精确匹配(整行
//! 字节等值,两处及以上命中 = 歧义,拒绝手术),替换为 new 块。行差异用 LCS(带
//! 格数上限,超限返回 None 走保守跳过 —— 大文件全量手术本就罕见)。纯内存操作,
//! 不触碰用户仓库。

/// hunk 匹配上下文行数。
const CTX: usize = 3;
/// 期望位置的搜索窗口(行):他人改动造成的行号漂移容忍度。
const WINDOW: i64 = 250;
/// LCS DP 格数上限:中段规模超过即放弃手术(保守跳过)。
const LCS_CAP: usize = 1_000_000;

/// 行切分(保留行尾;末行无换行符自成一行,"a" 与 "a\n" 视为不同行)。
fn split_lines(data: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start = 0usize;
    for (i, b) in data.iter().enumerate() {
        if *b == b'\n' {
            out.push(&data[start..=i]);
            start = i + 1;
        }
    }
    if start < data.len() {
        out.push(&data[start..]);
    }
    out
}

/// 差异段(base 坐标):从 base[start] 起替换 del 行为 ins 行。
type Span<'a> = (usize, usize, Vec<&'a [u8]>);

/// base→target 的行级差异(公共前后缀修剪 + LCS,升序、互不重叠)。
/// 超出 LCS 上限返回 None(放弃手术)。
fn diff_spans<'a>(base: &[&'a [u8]], target: &[&'a [u8]]) -> Option<Vec<Span<'a>>> {
    let mut p = 0usize;
    while p < base.len() && p < target.len() && base[p] == target[p] {
        p += 1;
    }
    let mut s = 0usize;
    while s < base.len() - p
        && s < target.len() - p
        && base[base.len() - 1 - s] == target[target.len() - 1 - s]
    {
        s += 1;
    }
    let mb = &base[p..base.len() - s];
    let mt = &target[p..target.len() - s];
    if mb.is_empty() && mt.is_empty() {
        return Some(Vec::new());
    }
    let (n, m) = (mb.len(), mt.len());
    if n.saturating_mul(m) > LCS_CAP {
        return None;
    }
    // dp[i][j] = mb[i..] 与 mt[j..] 的最长公共子序列长度
    let mut dp = vec![0u32; (n + 1) * (m + 1)];
    let idx = |i: usize, j: usize| i * (m + 1) + j;
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[idx(i, j)] = if mb[i] == mt[j] {
                dp[idx(i + 1, j + 1)] + 1
            } else {
                dp[idx(i + 1, j)].max(dp[idx(i, j + 1)])
            };
        }
    }
    let mut spans: Vec<Span<'a>> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n || j < m {
        if i < n && j < m && mb[i] == mt[j] {
            i += 1;
            j += 1;
            continue;
        }
        let start = p + i;
        let mut del = 0usize;
        let mut ins: Vec<&'a [u8]> = Vec::new();
        loop {
            if i < n && j < m && mb[i] == mt[j] {
                break;
            }
            if i >= n {
                ins.push(mt[j]);
                j += 1;
            } else if j >= m || dp[idx(i + 1, j)] >= dp[idx(i, j + 1)] {
                del += 1;
                i += 1;
            } else {
                ins.push(mt[j]);
                j += 1;
            }
            if i >= n && j >= m {
                break;
            }
        }
        spans.push((start, del, ins));
    }
    Some(spans)
}

struct Hunk<'a> {
    /// 上下文块在 base 的起始行(期望位置锚点)
    base_start: usize,
    /// 上下文 + 待变更行(base 内容)
    old: Vec<&'a [u8]>,
    /// 上下文 + 替换行(target 内容)
    new: Vec<&'a [u8]>,
}

/// 差异段 → 统一 hunk(上下文展开;相邻 hunk 上下文重叠即合并)。
fn build_hunks<'a>(base: &[&'a [u8]], spans: &[Span<'a>]) -> Vec<Hunk<'a>> {
    let mut out = Vec::new();
    let mut k = 0usize;
    while k < spans.len() {
        let (s0, d0, _) = spans[k];
        let mut end = s0 + d0 + CTX;
        let mut last = k;
        while last + 1 < spans.len() && spans[last + 1].0.saturating_sub(CTX) <= end {
            last += 1;
            end = spans[last].0 + spans[last].1 + CTX;
        }
        let start = s0.saturating_sub(CTX);
        let end = end.min(base.len());
        let old: Vec<&'a [u8]> = base[start..end].to_vec();
        let mut new: Vec<&'a [u8]> = Vec::new();
        let mut b = start;
        for (s, d, ins) in &spans[k..=last] {
            while b < *s {
                new.push(base[b]);
                b += 1;
            }
            new.extend_from_slice(ins);
            b = s + d;
        }
        while b < end {
            new.push(base[b]);
            b += 1;
        }
        out.push(Hunk {
            base_start: start,
            old,
            new,
        });
        k = last + 1;
    }
    out
}

/// 三方精准手术:把 base→target 的行级补丁应用到 ours 上(常见用法:
/// 回退 = ours/live 为布,base=批后像,target=批前像;应用 = base=批前像,
/// target=批后像)。逐 hunk 在期望位置 ±WINDOW 内找 old 块的唯一精确匹配;
/// 找不到(他人在同区域改过 / 差异过大)或找到多处(重复块歧义,最近启发式
/// 可能开错位置)一律返回 None,调用方按冲突跳过。
pub fn merge_patch(ours: &[u8], base: &[u8], target: &[u8]) -> Option<Vec<u8>> {
    let base_l = split_lines(base);
    let target_l = split_lines(target);
    let ours_l = split_lines(ours);
    let spans = diff_spans(&base_l, &target_l)?;
    if spans.is_empty() {
        return Some(ours.to_vec()); // 本批无净差异:布保持原样
    }
    let hunks = build_hunks(&base_l, &spans);

    let mut out: Vec<&[u8]> = Vec::with_capacity(ours_l.len());
    let mut cursor = 0usize; // 已消费的 ours 行
                             // 期望位置 = 上一 hunk 落点(ours 坐标)+ 与下一 hunk 的 base 间隔
    let mut prev_live_end = 0i64;
    let mut prev_base_end = 0usize;
    for h in &hunks {
        let exp = prev_live_end + (h.base_start as i64 - prev_base_end as i64);
        let max_start = ours_l.len().checked_sub(h.old.len())? as i64;
        let lo = (exp - WINDOW).max(cursor as i64).max(0);
        let hi = (exp + WINDOW).min(max_start);
        if hi < lo {
            return None;
        }
        let mut hit: Option<usize> = None;
        let mut pos = lo;
        while pos <= hi {
            if ours_l[pos as usize..pos as usize + h.old.len()] == *h.old {
                if hit.is_some() {
                    // 窗口内重复块:取最近者可能开错位置,歧义即冲突
                    return None;
                }
                hit = Some(pos as usize);
            }
            pos += 1;
        }
        let p = hit?;
        out.extend_from_slice(&ours_l[cursor..p]);
        out.extend_from_slice(&h.new);
        cursor = p + h.old.len();
        prev_live_end = cursor as i64;
        prev_base_end = h.base_start + h.old.len();
    }
    out.extend_from_slice(&ours_l[cursor..]);
    let mut buf = Vec::with_capacity(ours.len() + 64);
    for l in out {
        buf.extend_from_slice(l);
    }
    Some(buf)
}

#[cfg(test)]
mod tests {
    use super::merge_patch;

    /// 15 行文件:本批改 l2 与 l12,他人在 l8 插改 —— 两处相距超过
    /// 2×上下文,hunk 不合并,手术可逐块命中。
    fn v1() -> String {
        (1..=15).map(|i| format!("l{i}\n")).collect()
    }
    fn v2() -> String {
        v1().replace("l2\n", "l2-批\n").replace("l12\n", "l12-批\n")
    }
    fn live() -> String {
        v2().replace("l8\n", "l8-他人\n")
    }

    #[test]
    fn 擦除与重放互逆() {
        // 回退:擦除本批改动(l2/l12),他人 l8 写入保留
        let erased = merge_patch(live().as_bytes(), v2().as_bytes(), v1().as_bytes()).unwrap();
        let expect = live()
            .replace("l2-批\n", "l2\n")
            .replace("l12-批\n", "l12\n");
        assert_eq!(erased, expect.as_bytes());
        // 应用:把本批改动重放回擦除后的内容,他人写入仍在
        let replayed = merge_patch(&erased, v1().as_bytes(), v2().as_bytes()).unwrap();
        assert_eq!(replayed, live().as_bytes());
    }

    #[test]
    fn 同区域重叠_返回_none() {
        // 他人改的就是本批的 l2 行:擦除 hunk 上下文失配
        let live = live().replace("l2-批\n", "l2-他人\n");
        assert_eq!(
            merge_patch(live.as_bytes(), v2().as_bytes(), v1().as_bytes()),
            None
        );
    }

    #[test]
    fn 窗口内重复块_歧义拒绝手术() {
        // 本批把第二段 blk 的 K 改成 X,改后与既有第一段完全同文;他人在远处
        // 追加一行触发手术。回退方向 old 块(含改动行的 7 行块)在 live 两处
        // 命中:最近启发式在漂移下可能开错位置,必须按冲突拒绝,绝不静默覆盖。
        let blk_a = "h\ni\nj\nX\nl\nm\nn\n";
        let blk_b = "h\ni\nj\nK\nl\nm\nn\n";
        let gap = "g1\ng2\ng3\ng4\ng5\ng6\ng7\ng8\n";
        let v1 = format!("{blk_a}{gap}{blk_b}"); // 批前
        let v2 = format!("{blk_a}{gap}{blk_a}"); // 批后:第二段与第一段同文
        let live = format!("{v2}other\n"); // 他人远处追加
        assert_eq!(
            merge_patch(live.as_bytes(), v2.as_bytes(), v1.as_bytes()),
            None
        );
    }

    #[test]
    fn 无本批差异_原样返回() {
        let live = "x\ny\n".as_bytes();
        assert_eq!(merge_patch(live, b"x\ny\n", b"x\ny\n").unwrap(), live);
    }
}
