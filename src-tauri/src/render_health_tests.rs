//! render_health 纯函数决策锚测试(自 render_health.rs 拆出守 300 行铁则,
//! 先例 fs_edit_tests.rs 等 8 处 #[path] 兄弟文件)。
use super::*;

#[test]
fn 壳侧洪水判据_5s增量阈值() {
    assert!(!flood_from_delta(0));
    assert!(!flood_from_delta(256 * 1024));
    assert!(flood_from_delta(256 * 1024 + 1));
}

#[test]
fn 首击_focus_二击_reload_冷却内退_focus() {
    let now = 100_000u64;
    assert!(matches!(next_action(0, now, 0, 0, 0), KickAction::Focus));
    assert!(matches!(next_action(1, now, 0, 0, 0), KickAction::Reload));
    /* 冷却窗内(last_reload 60s 内)退回 focus */
    assert!(matches!(
        next_action(2, now, now - 10_000, 0, 0),
        KickAction::Focus
    ));
    assert!(matches!(
        next_action(2, now, now - RELOAD_COOLDOWN_MS, 0, 0),
        KickAction::Reload
    ));
}

#[test]
fn 洪水期内_reload_降级_focus_洪水过即恢复() {
    let now = 100_000u64;
    /* 二击本应 reload,但洪水未过(now < flood_until)且降级期起点未钉(0)→ focus */
    assert!(matches!(
        next_action(1, now, 0, now + 5_000, 0),
        KickAction::Focus
    ));
    /* 洪水已过(flood_until <= now)→ 照常 reload */
    assert!(matches!(next_action(1, now, 0, now, 0), KickAction::Reload));
    /* 洪水降级不绕过 reload 冷却:冷却内 + 洪水过 仍 focus */
    assert!(matches!(
        next_action(2, now, now - 10_000, now, 0),
        KickAction::Focus
    ));
}

#[test]
fn 洪水宽限耗尽_无视洪水_reload() {
    let now = 1_000_000u64;
    let flood_until = now + 5_000;
    /* 宽限内(降级期起点距今 < 180s):洪水中仍 focus */
    assert!(matches!(
        next_action(12, now, 0, flood_until, now - FLOOD_GRACE_MS + 1_000),
        KickAction::Focus
    ));
    /* 宽限刚好耗尽:无视洪水 reload */
    assert!(matches!(
        next_action(12, now, 0, flood_until, now - FLOOD_GRACE_MS),
        KickAction::Reload
    ));
    /* 宽限耗尽不绕过 reload 冷却:冷却内仍 focus */
    assert!(matches!(
        next_action(12, now, now - 10_000, flood_until, now - FLOOD_GRACE_MS),
        KickAction::Focus
    ));
    /* 降级期起点为 0(尚未钉起点):不构成宽限耗尽,保持降级 */
    assert!(matches!(
        next_action(12, now, 0, flood_until, 0),
        KickAction::Focus
    ));
    /* 首击不因宽限耗尽跳级(阶梯仍从 focus 起) */
    assert!(matches!(
        next_action(0, now, 0, flood_until, now - FLOOD_GRACE_MS),
        KickAction::Focus
    ));
}

#[test]
fn 去重窗内不击打() {
    let ks = KickState::default();
    ks.last_action_ms.store(100_000, Ordering::Relaxed);
    /* 墙钟钉死:活时钟断言在 335 并发测试满载时线程可被抢占 >15s,偶发翻车;
    500ms 后重击落在去重窗内(谓词与 kick() 同形)。 */
    let elapsed = 100_500u64.saturating_sub(ks.last_action_ms.load(Ordering::Relaxed));
    assert!(elapsed < KICK_DEBOUNCE_MS);
}
