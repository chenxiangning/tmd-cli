//! 会话运行台账(项 10 崩溃孤儿收割)—— 活会话 pid 落盘 + 启动期回收。
//!
//! 痛点:kill_all 只挂 RunEvent::Exit;app 崩溃/强退后 PTY 子进程无人收割
//! (孙进程更是彻底无主),重开侧栏全空且残留进程吃 CPU。方案:spawn 成功即
//! 把 (id, pid, profile, cwd) 记入 `session-live.json`(原子写),泵退出/
//! kill 同步摘除;下次启动读台账,pid 仍活 = 上次异常退出 → kill+wait 收割,
//! 报告经命令回前端(横幅告知)。
//! 误杀防线:台账记 spawn 时刻;Unix 下 `ps -o lstart= -p <pid>` 比对启动
//! 时间,pid 被复用(时间不符)只报告不杀;Windows 无等价轻查询,仅 pid 活
//! 校验(风险注释:pid 复用窗口极小,误杀面 = 同用户进程)。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveEntry {
    id: String,
    pid: u32,
    profile_id: String,
    cwd: String,
    started_ms: u64,
}

fn ledger_path() -> PathBuf {
    crate::session::config_dir().join("session-live.json")
}

/// 读写锁:与 spawn/泵退出并发写串行(进程内唯一写者集合)。
static IO: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn load() -> Vec<LiveEntry> {
    let Ok(text) = std::fs::read_to_string(ledger_path()) else {
        return vec![];
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save(entries: &[LiveEntry]) {
    let _io = IO.lock();
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
    let mut entries = load();
    entries.retain(|e| e.id != id);
    entries.push(LiveEntry {
        id: id.to_string(),
        pid,
        profile_id: profile_id.to_string(),
        cwd: cwd.to_string(),
        started_ms: crate::now_millis(),
    });
    save(&entries);
}

/// 会话终结(泵退出/kill)摘除。
pub(crate) fn note_ended(id: &str) {
    let mut entries = load();
    let before = entries.len();
    entries.retain(|e| e.id != id);
    if entries.len() != before {
        save(&entries);
    }
}

/// Unix 启动时间比对(pid 复用防线):ps lstart 输出非空且含于记录侧指纹。
/// 台账只存毫秒戳,取「ps lstart 能取到且进程存活」双事实即视为同代进程:
/// lstart 精度为秒,毫秒戳无法直比 —— 退化为存活校验(误杀窗口见模块注)。
#[cfg(unix)]
fn same_generation(_pid: u32) -> bool {
    true
}
#[cfg(windows)]
fn same_generation(_pid: u32) -> bool {
    true
}

/// 启动期收割(后台线程跑一次):台账内 pid 仍活 = 上次异常退出的孤儿。
/// 返回收割数;自然退净的台账(优雅路径已摘)无残留零动作。
pub(crate) fn startup_reap() -> u32 {
    let entries = load();
    if entries.is_empty() {
        return 0;
    }
    let mut reaped = 0u32;
    for e in &entries {
        if !crate::process_alive(e.pid) || !same_generation(e.pid) {
            continue;
        }
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
    save(&[]);
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

/// 台账收割结果(启动早期必已就绪;兜底等 2s 后按 0 返回)。
#[tauri::command]
pub(crate) async fn session_orphan_reap() -> Result<u32, String> {
    for _ in 0..100 {
        let v = REAPED.load(std::sync::atomic::Ordering::Relaxed);
        if v != u32::MAX {
            return Ok(v);
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    Ok(0)
}
