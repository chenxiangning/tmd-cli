//! 击打阶梯决策核(纯函数,测试锚;自 render_health 拆出:300 行铁则)。
//! 决策语义:首击 focus;二击起 reload,冷却内退 focus;洪水期内降级 focus
//! (reload = 重放缓冲 + 重挂全部幕布,洪水未停即再冻结,越自愈越卡 ——
//! 2026-09-30 第三轮卡死取证,见 kernel/floodGauge.ts);但降级有
//! FLOOD_GRACE_MS 宽限,耗尽仍零痊愈 = 永久冻结实锤,无视洪水 reload。
//! 常量(FLOOD_GRACE_MS/RELOAD_COOLDOWN_MS)与击打状态留宿主模块
//! render_health(子模块可见其私有项)。

use super::{FLOOD_GRACE_MS, RELOAD_COOLDOWN_MS};

pub(crate) enum KickAction {
    Focus,
    Reload,
}

pub(crate) fn next_action(
    strikes_before: u32,
    now_ms: u64,
    last_reload_ms: u64,
    flood_until_ms: u64,
    flood_since_ms: u64,
) -> KickAction {
    let n = strikes_before.saturating_add(1);
    let in_flood = now_ms < flood_until_ms;
    /* 宽限耗尽:降级期起点非零且距今超 FLOOD_GRACE_MS → 洪水不再是拦 reload 的理由 */
    let grace_exhausted =
        in_flood && flood_since_ms != 0 && now_ms.saturating_sub(flood_since_ms) >= FLOOD_GRACE_MS;
    if n > 1
        && (!in_flood || grace_exhausted)
        && now_ms.saturating_sub(last_reload_ms) >= RELOAD_COOLDOWN_MS
    {
        KickAction::Reload
    } else {
        KickAction::Focus
    }
}
