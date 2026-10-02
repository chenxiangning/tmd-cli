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
//! 击打只落在聚焦窗口:未聚焦窗口 rAF 停发属后台设计内暂停(遮挡节流),
//! 击打 = 抢用户焦点;真粘死在回焦时由 Focused 探针线检出接力。

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
/// 洪水降级最长宽限:连续洪水 + 零痊愈上报超过该值后,无视洪水直接 reload。
/// 降级防的是「reload 回放风暴再冻结」,但若洪水不止(重度并发长任务)则击打
/// 永远停在 set_focus —— 而 set_focus 对吊销态是实测无效路径,宽限无限 =
/// 永久冻结、只能手动刷新客户端(2026-10-01 定案)。永久冻结比重载风暴更糟:
/// reload 语义安全(会话/PTY 跨重载存活),宽限耗尽即升级,此后按 reload 冷却
/// 节拍重试,直到页面复话。
const FLOOD_GRACE_MS: u64 = 180_000;
const HEARTBEAT_TICK_MS: u64 = 5_000;
/// 心跳死线:窗口可见但 15s 无任何上报(含健康心跳)= webview 深冻,
/// 页内自报线已死,由壳侧接管进击(击打仍受聚焦闸约束,后台不抢焦点)。
const HEARTBEAT_DEAD_MS: u64 = 15_000;

/// 全局 PTY 发字节数(泵 emit 处累加)。壳侧洪水计量源:传感器在 Rust 侧,
/// webview 冻结后前端 floodGauge 不再可用,洪水判定不能依赖前端旗标。
static PTY_BYTES_EMITTED: AtomicU64 = AtomicU64::new(0);

/// 泵 emit 处按批累加(UTF-8 字节;与 floodGauge 字符数同量级,ANSI 流以
/// ASCII 为主,共用 256KB/5s 阈值不失真)。
pub(crate) fn note_pty_emitted(bytes: usize) {
    PTY_BYTES_EMITTED.fetch_add(bytes as u64, Ordering::Relaxed);
}

/// 壳侧洪水判据(纯函数,测试锚):5s 节拍内的发字节数增量过 256KB(≈50KB/s,
/// 与 kernel/floodGauge.ts 同阈值同语义)。
fn flood_from_delta(delta_bytes: u64) -> bool {
    delta_bytes > 256 * 1024
}

#[derive(Default)]
pub(crate) struct KickState {
    last_action_ms: AtomicU64,
    last_reload_ms: AtomicU64,
    last_report_ms: AtomicU64,
    /// 洪水期截止时刻(前端 floodGauge 随 stuck 上报刷新):期内 reload 降级为 focus。
    flood_until_ms: AtomicU64,
    /// 洪水降级期起点(首次被降级击打的时刻;0 = 不在降级期)。痊愈(ok 上报)
    /// 与洪过(非洪水击打)清零;供 FLOOD_GRACE_MS 宽限判定,防洪水不止时永久 focus。
    flood_since_ms: AtomicU64,
    strikes: AtomicU32,
}

/// 阶梯决策(纯函数,测试锚):首击 focus;二击起 reload,冷却内退 focus;
/// 洪水期内降级 focus(reload = 重放缓冲 + 重挂全部幕布,洪水未停即再冻结,
/// 越自愈越卡 —— 2026-09-30 第三轮卡死取证,见 kernel/floodGauge.ts);
/// 但降级有 FLOOD_GRACE_MS 宽限,耗尽仍零痊愈 = 永久冻结实锤,无视洪水 reload。
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

fn kick(window: &WebviewWindow, ks: &KickState) {
    /* 聚焦闸:未聚焦窗口 rAF 停发是后台设计内暂停,不是粘死;此时击打 =
    从用户手里抢焦点(2026-10-01 反馈:切去浏览器每 10 余秒被弹回)。
    真粘死在用户回焦时由 Focused 探针线检出接力,聚焦态击打不受影响。 */
    if !window.is_focused().unwrap_or(false) {
        return;
    }
    let now = now_millis();
    if now.saturating_sub(ks.last_action_ms.load(Ordering::Relaxed)) < KICK_DEBOUNCE_MS {
        return;
    }
    ks.last_action_ms.store(now, Ordering::Relaxed);
    /* 降级期记账:洪水中首次击打钉起点;洪过清零(痊愈清零在 render_health ok 分支)。 */
    let flood_until = ks.flood_until_ms.load(Ordering::Relaxed);
    if now < flood_until {
        let _ = ks
            .flood_since_ms
            .compare_exchange(0, now, Ordering::Relaxed, Ordering::Relaxed);
    } else {
        ks.flood_since_ms.store(0, Ordering::Relaxed);
    }
    let strikes = ks.strikes.fetch_add(1, Ordering::Relaxed) + 1;
    match next_action(
        strikes - 1,
        now,
        ks.last_reload_ms.load(Ordering::Relaxed),
        flood_until,
        ks.flood_since_ms.load(Ordering::Relaxed),
    ) {
        KickAction::Reload => {
            ks.last_reload_ms.store(now, Ordering::Relaxed);
            crate::app_setup::safe_eprintln(&format!(
                "render_health: 渲染粘死未愈(strikes={strikes}){},重载 webview;会话/PTY 跨重载存活",
                if now < flood_until {
                    ",洪水宽限耗尽强击"
                } else {
                    ""
                },
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
        /* 痊愈:strikes 与洪水降级期一并清零,下一轮冻结重新计宽限。 */
        ks.strikes.store(0, Ordering::Relaxed);
        ks.flood_since_ms.store(0, Ordering::Relaxed);
        return;
    }
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

/// 壳侧心跳守望(常驻线程):检测传感器移出 webview —— 吊销深冻时页内定时器
/// 同样饥饿(rafFallback 自报线死亡),Focused 探针又只在焦点切换时触发,
/// 用户盯死冻结窗口时两条检出线全哑,阶梯永停、只能手动刷新客户端(2026-10-01
/// 根因定案)。本线程每 5s 独立判定:窗口可见但 15s 无任何上报 = 深冻,进击
/// (击打经聚焦闸,未聚焦窗口不骚扰,回焦由探针线接力);
/// 洪水判定用本进程泵计量(note_pty_emitted),不问前端 —— 洪水期 reload 仍
/// 降级 focus(防回放风暴),洪过(轮次总会结束)下一拍自动升级 reload,闭环。
pub(crate) fn init_watchdog(window: WebviewWindow) {
    std::thread::spawn(move || {
        let mut last_bytes = 0u64;
        loop {
            std::thread::sleep(Duration::from_millis(HEARTBEAT_TICK_MS));
            let now = now_millis();
            let cur = PTY_BYTES_EMITTED.load(Ordering::Relaxed);
            let delta = cur.saturating_sub(last_bytes);
            last_bytes = cur;
            let state = window.state::<AppState>();
            let ks = &state.render_kick;
            if flood_from_delta(delta) {
                ks.flood_until_ms.store(now + 10_000, Ordering::Relaxed);
            }
            /* 真隐藏/最小化 = 按设计暂停,不判死不击打(与上报路径同律)。 */
            if !window.is_visible().unwrap_or(true) {
                continue;
            }
            let last = ks.last_report_ms.load(Ordering::Relaxed);
            if last != 0 && now.saturating_sub(last) >= HEARTBEAT_DEAD_MS {
                kick(&window, ks);
            }
        }
    });
}

#[cfg(test)]
#[path = "render_health_tests.rs"]
mod tests;
