//! 会话日志磁盘治理 —— 启动期 sweep + 存储管家手动清理。
//!
//! 痛点:日志清理唯一挂点在泵线程退出路径(pty_spawn 优雅退出删文件),
//! app 崩溃/强退/webview 宿主被杀后 `.log`/`.logptr`/`.tmp` 永久残留
//! (2026-10-26 本机实证 8.5GB / 2253 文件,其中 8.36GB 超 2 天未动)。
//! 方案:按保留天数(mtime TTL)启动后台清一轮,活会话(仍在日志账本
//! 中)永不删;settings.json 的 `sessionLogRetentionDays` 控制策略:
//! 缺省 7 天,0 = 关闭启动清理。手动命令 days=0 表示全清(仍保活会话)。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

/// 清理结果(回前端展示回收量)。
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SweepReport {
    pub removed_files: u64,
    pub removed_bytes: u64,
    pub removed_dirs: u64,
}

/// 可清后缀:.log 会话日志 / .logptr 磁盘会话指针 / .tmp 旋转中断残留。
fn sweepable(name: &str) -> bool {
    name.ends_with(".log") || name.ends_with(".logptr") || name.ends_with(".tmp")
}
/// 手动全清(days=0)的活性宽限:mtime 新于该值的文件保留(spawn 竞态期
/// 活会话可能尚未进账本)。
const MANUAL_FRESH_GRACE: Duration = Duration::from_secs(60);

/// 目录空则删,回传是否回收(供上层引擎目录连坐判断)。
fn remove_dir_if_empty(dir: &Path, report: &mut SweepReport) {
    if std::fs::read_dir(dir).is_ok_and(|mut d| d.next().is_none())
        && std::fs::remove_dir(dir).is_ok()
    {
        report.removed_dirs += 1;
    }
}

/// 扫 session 树(`session/<引擎>/<项目>/<文件>` 三层):超 TTL 且非活
/// 会话的日志类文件删除,清空后的项目/引擎目录回收。days=0 全清(仅保
/// 活会话)。now 注入可测;未知子目录与不可删文件都保留目录不连坐。
fn sweep_tree(root: &Path, days: u64, live: &HashSet<PathBuf>, now: SystemTime) -> SweepReport {
    let ttl = Duration::from_secs(days.saturating_mul(86_400));
    let mut report = SweepReport::default();
    let Ok(engines) = std::fs::read_dir(root) else {
        return report;
    };
    for engine in engines.flatten() {
        if !engine.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(projects) = std::fs::read_dir(engine.path()) else {
            continue;
        };
        for project in projects.flatten() {
            if !project.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let mut emptied = true;
            if let Ok(files) = std::fs::read_dir(project.path()) {
                for f in files.flatten() {
                    let p = f.path();
                    let name = f.file_name().to_string_lossy().into_owned();
                    let age = f
                        .metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|mtime| now.duration_since(mtime).ok());
                    /* 未知形态(子目录/不可清名/元数据失败)一律保目录不连坐。
                     * days=0(手动全清)无 TTL 闸,但 mtime 极新(<60s)的文件
                     * 可能正被活会话写入而账本尚未登记(spawn 竞态),同样保留。 */
                    let keep = !p.is_file()
                        || !sweepable(&name)
                        || live.contains(&p)
                        || f.metadata().is_err()
                        || age.is_none()
                        || (days > 0 && age.is_some_and(|a| a < ttl))
                        || (days == 0 && age.is_some_and(|a| a < MANUAL_FRESH_GRACE));
                    if keep {
                        emptied = false;
                        continue;
                    }
                    let bytes = f.metadata().map(|m| m.len()).unwrap_or(0);
                    if std::fs::remove_file(&p).is_ok() {
                        report.removed_files += 1;
                        report.removed_bytes += bytes;
                    } else {
                        emptied = false;
                    }
                }
            }
            if emptied {
                remove_dir_if_empty(&project.path(), &mut report);
            }
        }
        remove_dir_if_empty(&engine.path(), &mut report);
    }
    report
}

/// 活会话日志路径集合(账本内全部 path;sweep 判定的唯一保护源)。
fn live_log_paths(state: &crate::AppState) -> HashSet<PathBuf> {
    state
        .pty
        .logs
        .lock()
        .values()
        .map(|m| m.path.clone())
        .collect()
}

/// settings.json 的保留天数:缺省 7;0 = 用户关闭启动清理。
fn retention_days(settings: &serde_json::Value) -> u64 {
    settings
        .get("sessionLogRetentionDays")
        .and_then(serde_json::Value::as_u64)
        /* 默认与 TS 真源 settingsSessionEntries.ts 对齐,改档位两处同步 */
        .unwrap_or(7)
}

/// 启动期一轮(setup 内后台线程执行;与首屏零竞争:sweep 只删 TTL 外
/// 文件,新 spawn 会话的 mtime 必新)。
pub(crate) fn run_startup(state: &crate::AppState) {
    let days = retention_days(&crate::settings::load_settings());
    if days == 0 {
        return;
    }
    let live = live_log_paths(state);
    let root = crate::session::config_dir().join("session");
    let report = sweep_tree(&root, days, &live, SystemTime::now());
    if report.removed_files > 0 {
        println!(
            "session_log_sweep: 清理超 {days} 天日志 {} 个文件,回收 {} 字节",
            report.removed_files, report.removed_bytes
        );
    }
}

/// 手动清理(存储管家):days 取自设置策略或 0=全清;活会话永不动。
#[tauri::command]
pub(crate) async fn session_log_cleanup(
    state: tauri::State<'_, crate::AppState>,
    days: u64,
) -> Result<SweepReport, String> {
    let live = live_log_paths(&state);
    let root = crate::session::config_dir().join("session");
    tauri::async_runtime::spawn_blocking(move || sweep_tree(&root, days, &live, SystemTime::now()))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "session_log_sweep_tests.rs"]
mod tests;
