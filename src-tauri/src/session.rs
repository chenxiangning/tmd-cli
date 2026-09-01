//! 会话注册表：Session = 1 CLI profile + 1 PTY + CLI 自身 session id（第六轮决策）。
//!
//! 持久化到 `~/.tmd-cli/sessions.json`。启动时恢复;每个状态变更落盘。

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub profile_id: String,
    pub cwd: String,
    pub pid: Option<u32>,
    /// CLI 自身的 session id（如 codex 的 rollout id），用于 resume。可空 = 尚未探测到。
    pub cli_session_id: Option<String>,
}

/// 用户全局配置目录: `~/.tmd-cli/`。所有客户端本地数据落此。
/// 与 macOS 系统 Library 目录解耦,便于备份/清理。
pub fn config_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".tmd-cli")
}

/// 配置目录下 sessions 持久化文件路径。
pub fn sessions_file() -> PathBuf {
    config_dir().join("sessions.json")
}

/// 确保 `~/.tmd-cli/` 目录存在。
pub fn ensure_config_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir())
}

/// 从磁盘读取会话清单。启动时调用。不存在或读取失败 = 空表。
pub fn load_sessions() -> Vec<SessionMeta> {
    let file = sessions_file();
    match std::fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 把当前会话清单落盘。每个状态变化(spawn/kill)后调用。
pub fn save_sessions(sessions: &[SessionMeta]) -> std::io::Result<()> {
    ensure_config_dir()?;
    let file = sessions_file();
    let json = serde_json::to_string_pretty(sessions)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(&file, json)
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionMeta>>,
}

impl SessionRegistry {
    pub fn register(&self, meta: SessionMeta) {
        self.sessions.lock().insert(meta.id.clone(), meta);
        self.persist();
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        self.sessions.lock().values().cloned().collect()
    }

    pub fn remove(&self, id: &str) {
        self.sessions.lock().remove(id);
        self.persist();
    }

    /// 启动时:从磁盘恢复到内存表。CLI 进程已死或 cwd 已不存在 = 仅留记录,可点开重连。
    pub fn restore_from_disk(&self) {
        let loaded = load_sessions();
        let mut map = self.sessions.lock();
        for meta in loaded {
            map.entry(meta.id.clone()).or_insert(meta);
        }
    }

    fn persist(&self) {
        let all: Vec<SessionMeta> = self.sessions.lock().values().cloned().collect();
        let _ = save_sessions(&all);
    }
}
