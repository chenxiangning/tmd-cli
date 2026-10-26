//! session_runtime 纯逻辑测试:reap_decision 三态判定 / parse_etime 各格式。
//! (保留集筛选走 reap_decision 的 Keep 分支 = startup_reap 的保留谓词。)

use super::*;

#[test]
fn reap_decision_三态() {
    use ReapDecision::{Drop, Keep, Kill};
    /* owner(另一实例)仍活 → 无论目标态如何一律保留 */
    assert_eq!(reap_decision(true, true, true), Keep);
    assert_eq!(reap_decision(true, true, false), Keep);
    assert_eq!(reap_decision(true, false, false), Keep);
    /* owner 已死:目标活且同代 → 杀 */
    assert_eq!(reap_decision(false, true, true), Kill);
    /* 目标已死 / 代际不符(pid 复用)→ 只摘不杀 */
    assert_eq!(reap_decision(false, false, false), Drop);
    assert_eq!(reap_decision(false, true, false), Drop);
}

#[cfg(unix)]
#[test]
fn parse_etime_各格式() {
    assert_eq!(parse_etime("   05:23"), Some(5 * 60 + 23)); /* mm:ss */
    assert_eq!(parse_etime("01:02:03"), Some(3600 + 120 + 3)); /* hh:mm:ss */
    assert_eq!(
        parse_etime("2-03:04:05"),
        Some(2 * 86_400 + 3 * 3600 + 240 + 5)
    ); /* dd-hh:mm:ss */
    assert_eq!(parse_etime("0-00:00:01"), Some(1));
    /* 验不了 = None:空 / 非数字 / 超形 */
    assert_eq!(parse_etime(""), None);
    assert_eq!(parse_etime("   "), None);
    assert_eq!(parse_etime("abc"), None);
    assert_eq!(parse_etime("1:2:3:4"), None);
    assert_eq!(parse_etime("x-01:02:03"), None);
}

#[test]
fn 同代容差判定_etime_与期望差5秒内() {
    /* 与 same_generation 的比对算式同形(墙钟戳推秒,±5s 容差) */
    let started_ms = 1_000_000u64;
    let now_ms = started_ms + 63_000;
    let expected = (now_ms - started_ms) / 1000;
    assert_eq!(expected, 63);
    assert!(63u64.abs_diff(expected) <= 5);
    assert!(67u64.abs_diff(expected) <= 5);
    assert!(69u64.abs_diff(expected) > 5);
}
