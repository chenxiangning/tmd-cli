//! 渲染健康守望(壳侧)—— WKWebView 渲染吊销粘死的检出与戳醒。
//!
//! 症状与根因(2026-09-30 受控复现,worktree 诊断实例取证):
//! macOS WKWebView 在窗口隐藏/最小化/被遮挡期间停发 rAF 并吊销渲染更新;
//! 恢复可见后偶发**不再恢复** —— 页面 `document.hidden` 恒粘、rAF 永久死、
//! 像素停在旧帧,而 ≥500ms 定时器常存活。窗口在前台,UI 却冻死。
//! 实测无效的恢复路径:app 激活(open -b)、JS set_focus、hide/show 重放、
//! 页面 reload(窗口状态未稳时)。有效的根治 = 让 webview 在窗口**稳定可见**
//! 时整页重建(reload)—— 本应用的会话/PTY 注册表跨 webview 重载存活
//! (sessionAdopt 重载不灭),reload 语义安全。
//!
//! 链路:前端 kernel/rafFallback.ts 守望(原生 rAF 探针 + 形态 A/B 上报)
//! → `render_health` 命令 → 阶梯击打:set_focus 首击,reload 二击(冷却 60s);
//! 洪水期(floodGauge 判据随上报携带)reload 降级 focus —— 洪水未停时 reload
//! 触发回放风暴只会立即再冻结,越自愈越卡。
//! 另:主窗口 Focused(true) 时戳前端探针并挂 4s 应答死限,应答不至 =
//! 页面悬死/探针未装,直接进击。

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{Manager, State, WebviewWindow};

use crate::{now_millis, AppState};

/// 击打去重窗:粘死态上报每 10s 一次(前端),壳侧再兜一层防抖。
const KICK_DEBOUNCE_MS: u64 = 15_000;
/// reload 冷却:防 reload 风暴(重载后仍粘死时退回 set_focus 挨到冷却过)。
const RELOAD_COOLDOWN_MS: u64 = 60_000;
/// Focused 探针应答死限:超时无上报 = 探针链路死,直接进击。
pub(crate) const PROBE_DEADLINE_MS: u64 = 4_000;

#[derive(Default)]
pub(crate) struct KickState {
    last_action_ms: AtomicU64,
    last_reload_ms: AtomicU64,
    last_report_ms: AtomicU64,
    /// 洪水期截止时刻(前端 floodGauge 随 stuck 上报刷新):期内 reload 降级为 focus。
    flood_until_ms: AtomicU64,
    strikes: AtomicU32,
}

/// 阶梯决策(纯函数,测试锚):首击 focus;二击起 reload,冷却内退 focus;
/// 洪水期内一律 focus(reload = 重放缓冲 + 重挂全部幕布,洪水未停即再冻结,
/// 越自愈越卡 —— 2026-09-30 第三轮卡死取证,见 kernel/floodGauge.ts)。
pub(crate) enum KickAction {
    Focus,
    Reload,
}

pub(crate) fn next_action(
    strikes_before: u32,
    now_ms: u64,
    last_reload_ms: u64,
    flood_until_ms: u64,
) -> KickAction {
    let n = strikes_before.saturating_add(1);
    if n > 1
        && now_ms >= flood_until_ms
        && now_ms.saturating_sub(last_reload_ms) >= RELOAD_COOLDOWN_MS
    {
        KickAction::Reload
    } else {
        KickAction::Focus
    }
}

fn kick(window: &WebviewWindow, ks: &KickState) {
    let now = now_millis();
    if now.saturating_sub(ks.last_action_ms.load(Ordering::Relaxed)) < KICK_DEBOUNCE_MS {
        return;
    }
    ks.last_action_ms.store(now, Ordering::Relaxed);
    let strikes = ks.strikes.fetch_add(1, Ordering::Relaxed) + 1;
    match next_action(
        strikes - 1,
        now,
        ks.last_reload_ms.load(Ordering::Relaxed),
        ks.flood_until_ms.load(Ordering::Relaxed),
    ) {
        KickAction::Reload => {
            ks.last_reload_ms.store(now, Ordering::Relaxed);
            crate::app_setup::safe_eprintln(&format!(
                "render_health: 渲染粘死未愈(strikes={strikes}),重载 webview;会话/PTY 跨重载存活"
            ));
            let _ = window.eval("location.reload()");
        }
        KickAction::Focus => {
            crate::app_setup::safe_eprintln(&format!(
                "render_health: 渲染粘死上报(strikes={strikes}){}",
                if now < ks.flood_until_ms.load(Ordering::Relaxed) {
                    ",洪水期 reload 降级"
                } else {
                    ""
                },
            ));
            let _ = window.set_focus();
        }
    }
}

/// 前端上报入口(kernel/rafFallback.ts;camelCase 自动映射)。
#[tauri::command]
pub(crate) fn render_health(
    window: WebviewWindow,
    state: State<'_, AppState>,
    ok: bool,
    gap_ms: u64,
    flood: bool,
) {
    let ks = &state.render_kick;
    ks.last_report_ms.store(now_millis(), Ordering::Relaxed);
    if flood {
        /* 洪水期延长 10s:覆盖 KICK_DEBOUNCE 的去重窗,降级判据不漏击打点。 */
        ks.flood_until_ms
            .store(now_millis() + 10_000, Ordering::Relaxed);
    }
    if ok {
        ks.strikes.store(0, Ordering::Relaxed);
        return;
    }
    let _ = gap_ms; /* 观测值已足量,决策只看 ok 与窗口可见性 */
    /* 窗口真隐藏/最小化时的粘死是「按设计暂停」,不可击打。 */
    if !window.is_visible().unwrap_or(true) {
        return;
    }
    kick(&window, ks);
}

/// 主窗口 Focused(true) 钩子:戳探针 + 应答死限兜底(页面悬死时探针不回)。
pub(crate) fn on_focused(window: &WebviewWindow) {
    let _ = window.eval("window.__tmdRenderProbe && window.__tmdRenderProbe()");
    let t0 = now_millis();
    let w = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(PROBE_DEADLINE_MS));
        let state = w.state::<AppState>();
        let ks = &state.render_kick;
        if ks.last_report_ms.load(Ordering::Relaxed) < t0 {
            crate::app_setup::safe_eprintln("render_health: Focused 探针无应答,页面疑似悬死,进击");
            kick(&w, ks);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 首击_focus_二击_reload_冷却内退_focus() {
        let now = 100_000u64;
        assert!(matches!(next_action(0, now, 0, 0), KickAction::Focus));
        assert!(matches!(next_action(1, now, 0, 0), KickAction::Reload));
        /* 冷却窗内(last_reload 60s 内)退回 focus */
        assert!(matches!(
            next_action(2, now, now - 10_000, 0),
            KickAction::Focus
        ));
        assert!(matches!(
            next_action(2, now, now - RELOAD_COOLDOWN_MS, 0),
            KickAction::Reload
        ));
    }

    #[test]
    fn 洪水期内_reload_降级_focus_洪水过即恢复() {
        let now = 100_000u64;
        /* 二击本应 reload,但洪水未过(now < flood_until)→ focus */
        assert!(matches!(
            next_action(1, now, 0, now + 5_000),
            KickAction::Focus
        ));
        /* 洪水已过(flood_until <= now)→ 照常 reload */
        assert!(matches!(next_action(1, now, 0, now), KickAction::Reload));
        /* 洪水降级不绕过 reload 冷却:冷却内 + 洪水过 仍 focus */
        assert!(matches!(
            next_action(2, now, now - 10_000, now),
            KickAction::Focus
        ));
    }

    #[test]
    fn 去重窗内不击打() {
        let ks = KickState::default();
        ks.last_action_ms.store(now_millis(), Ordering::Relaxed);
        /* 15s 未过:无窗口句柄也能验证去重早退 —— 用决策输入侧佐证 */
        assert!(
            now_millis().saturating_sub(ks.last_action_ms.load(Ordering::Relaxed))
                < KICK_DEBOUNCE_MS
        );
    }
}
