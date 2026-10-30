//! 会话运行台账(项 10 崩溃孤儿收割)—— 活会话 pid 落盘 + 启动期回收。
//!
//! 痛点:kill_all 只挂 RunEvent::Exit;app 崩溃/强退后 PTY 子进程无人收割
//! (孙进程更是彻底无主),重开侧栏全空且残留进程吃 CPU。方案:spawn 成功即
//! 把 (id, pid, owner_pid, profile, cwd) 记入 `session-live.json`(原子写),
//! 泵退出/kill 同步摘除;下次启动读台账,pid 仍活 = 上次异常退出 → kill+wait
//! 收割,报告经命令回前端(横幅告知)。
//! 误杀防线(三层):
//! ① owner_pid(登记进程):收割时 owner 仍活 = 另一实例的活会话,跳过并保留
//!   (双实例互杀封口;也封掉本实例 relay 自启先于收割的窄窗);
//! ② Unix `ps -o etime=` 反推进程运行秒数,与台账 started_ms 比对(±5s 容差),
//!   不符 = pid 已被复用,只报告不杀;ps 取不到/解析失败同样只报告不杀;
//! ③ Windows 无等价轻查询,仅 pid 存活校验 —— 复用窗口内仍可能误杀同用户
//!   进程,由 ① 的 owner_pid 防线压缩暴露面(活 owner 的条目不参与收割)。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveEntry {
    id: String,
    pid: u32,
    /// 登记该条目的进程 pid:收割时 owner 仍活 = 另一实例活会话,保留不杀。
    /// default:旧台账无此字段视 owner=0(永不活),走既有收割路径。
    #[serde(default)]
    owner_pid: u32,
    profile_id: String,
    cwd: String,
    started_ms: u64,
}

fn ledger_path() -> PathBuf {
    crate::session::config_dir().join("session-live.json")
}

/// 读写锁:罩住 load→改→save 全程(note_started 在 spawn_blocking、note_ended
/// 在泵线程并发,锁外 load 后写覆盖先写会静默丢活条目)。
static IO: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn load() -> Vec<LiveEntry> {
    let Ok(text) = std::fs::read_to_string(ledger_path()) else {
        return vec![];
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// 落盘(调用点须已持 IO 锁;空集 = 删台账文件)。
fn save(entries: &[LiveEntry]) {
    let path = ledger_path();
    if entries.is_empty() {
        let _ = std::fs::remove_file(&path);
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(entries) else {
        return;
    };
    let _ = crate::session::write_json_atomic(&path, &json);
}

/// spawn 成功后登记(append;台账损坏 = 清空重来,不阻塞会话)。
pub(crate) fn note_started(id: &str, pid: u32, profile_id: &str, cwd: &str) {
    let _io = IO.lock();
    let mut entries = load();
    entries.retain(|e| e.id != id);
    entries.push(LiveEntry {
        id: id.to_string(),
        pid,
        owner_pid: std::process::id(),
        profile_id: profile_id.to_string(),
        cwd: cwd.to_string(),
        started_ms: crate::now_millis(),
    });
    save(&entries);
}

/// 会话终结(泵退出/kill)摘除。
pub(crate) fn note_ended(id: &str) {
    let _io = IO.lock();
    let mut entries = load();
    let before = entries.len();
    entries.retain(|e| e.id != id);
    if entries.len() != before {
        save(&entries);
    }
}

/// ps etime 输出解析为秒,格式 `[[dd-]hh:]mm:ss`(纯函数,测试锚);
/// 空/超形/非数字 → None(验不了 = 不杀)。
#[cfg(unix)]
fn parse_etime(text: &str) -> Option<u64> {
    let s = text.trim();
    if s.is_empty() {
        return None;
    }
    let (days, rest) = match s.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().ok()?, r),
        None => (0, s),
    };
    let fields: Vec<&str> = rest.split(':').collect();
    if !(2..=3).contains(&fields.len()) {
        return None;
    }
    /* 权重按字段数右对齐:[hh:]mm:ss → 不足位不补(分秒必在,时可选)。 */
    let weights = [3600u64, 60, 1];
    let offset = 3 - fields.len();
    let mut total = days * 86_400;
    for (i, f) in fields.iter().enumerate() {
        total = total.checked_add(f.parse::<u64>().ok()? * weights[offset + i])?;
    }
    Some(total)
}

/// Unix pid 复用防线:ps etime 与台账 started_ms 推算的期望运行时长比对
/// (±5s 容差);ps 无输出/解析失败 = 验不了,不杀只报告。
#[cfg(unix)]
fn same_generation(pid: u32, started_ms: u64, now_ms: u64) -> bool {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-o", "etime=", "-p", &pid.to_string()])
        .output()
    else {
        return false;
    };
    match parse_etime(&String::from_utf8_lossy(&out.stdout)) {
        Some(etime) => {
            let expected = now_ms.saturating_sub(started_ms) / 1000;
            etime.abs_diff(expected) <= 5
        }
        None => false,
    }
}

/// Windows:无等价轻查询,仅 pid 存活校验(复用窗口风险见模块注,由
/// owner_pid 防线压缩)。
#[cfg(windows)]
fn same_generation(_pid: u32, _started_ms: u64, _now_ms: u64) -> bool {
    true
}

/// 收割判定(纯函数,测试锚):
/// - Keep:owner(登记进程)仍活 = 另一实例的活会话,保留不杀;
/// - Drop:目标 pid 已死或代际不符(pid 复用),不杀,台账摘除;
/// - Kill:确认是上次异常退出的孤儿,SIGTERM/taskkill。
#[derive(Debug, PartialEq, Eq)]
enum ReapDecision {
    Kill,
    Drop,
    Keep,
}

fn reap_decision(owner_alive: bool, target_alive: bool, same_generation: bool) -> ReapDecision {
    if owner_alive {
        ReapDecision::Keep
    } else if target_alive && same_generation {
        ReapDecision::Kill
    } else {
        ReapDecision::Drop
    }
}

/// 启动期收割(后台线程跑一次):台账内 pid 仍活 = 上次异常退出的孤儿。
/// 返回收割数;自然退净的台账(优雅路径已摘)无残留零动作。
/// 另一实例的活会话(owner 仍活)保留在台账,不杀不摘。
pub(crate) fn startup_reap() -> u32 {
    let _io = IO.lock();
    let entries = load();
    if entries.is_empty() {
        return 0;
    }
    let self_pid = std::process::id();
    let now = crate::now_millis();
    let mut reaped = 0u32;
    let mut kept: Vec<LiveEntry> = Vec::new();
    for e in entries {
        let owner_alive = e.owner_pid != self_pid && crate::process_alive(e.owner_pid);
        match reap_decision(
            owner_alive,
            crate::process_alive(e.pid),
            same_generation(e.pid, e.started_ms, now),
        ) {
            ReapDecision::Keep => kept.push(e),
            ReapDecision::Drop => {
                crate::app_setup::safe_eprintln(&format!(
                    "session_runtime: 台账条目 {}(pid={})已死或代际不符(pid 复用防线),只摘不杀",
                    e.id, e.pid
                ));
            }
            ReapDecision::Kill => {
                /* 只杀直接子进程(台账里只有它们);孙进程由子进程的 SIGHUP 链自理 */
                unsafe {
                    #[cfg(unix)]
                    {
                        libc::kill(e.pid as i32, libc::SIGTERM);
                    }
                    #[cfg(windows)]
                    {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/PID", &e.pid.to_string(), "/F"])
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .status();
                    }
                }
                reaped += 1;
                crate::app_setup::safe_eprintln(&format!(
                    "session_runtime: 收割上次异常退出残留会话 {}(pid={},引擎 {})",
                    e.id, e.pid, e.profile_id
                ));
            }
        }
    }
    save(&kept);
    reaped
}

/// setup 期调用(一次性):后台跑收割并落 static;幂等由「台账已被清空」
/// 天然保证,命令侧只读结果。
static REAPED: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(u32::MAX);

pub(crate) fn run_startup_reap_bg() {
    std::thread::spawn(|| {
        let n = startup_reap();
        REAPED.store(n, std::sync::atomic::Ordering::Relaxed);
    });
}

/// 台账收割结果(启动早期必已就绪;Windows 批量收割可能超 2s,兜底轮询
/// 预算 100×50ms=5s,超时按 0 返回)。
#[tauri::command]
pub(crate) async fn session_orphan_reap() -> Result<u32, String> {
    for _ in 0..100 {
        let v = REAPED.load(std::sync::atomic::Ordering::Relaxed);
        if v != u32::MAX {
            return Ok(v);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    Ok(0)
}

#[cfg(test)]
#[path = "session_runtime_tests.rs"]
mod tests;
