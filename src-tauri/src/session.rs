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
    /// 所属工作区 id;老 session 无此字段时归到 default。
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// 创建时间 ms epoch。老 session 无 = 0,前端展示 fallback。
    #[serde(default)]
    pub created_at: u64,
    /// 用户自定义 label(默认 = profileId + 短 id)。
    #[serde(default)]
    pub display_label: Option<String>,
    pub pid: Option<u32>,
    /// CLI 自身的 session id（如 codex 的 rollout id），用于 resume。可空 = 尚未探测到。
    pub cli_session_id: Option<String>,
}

/// 工作区元数据。持久化到 `~/.tmd-cli/workspaces.json`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    pub root: String,
    pub created_at: u64,
}

/// workspaces.json 顶层结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacesFile {
    #[serde(default)]
    pub list: Vec<WorkspaceMeta>,
    #[serde(default)]
    pub active_id: Option<String>,
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

/// 配置目录下 workspaces 持久化文件路径。
pub fn workspaces_file() -> PathBuf {
    config_dir().join("workspaces.json")
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

/// 读取工作区列表。文件不存在返回空结构。
pub fn load_workspaces() -> WorkspacesFile {
    let file = workspaces_file();
    match std::fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => WorkspacesFile::default(),
    }
}

impl Default for WorkspacesFile {
    fn default() -> Self {
        WorkspacesFile {
            list: Vec::new(),
            active_id: None,
        }
    }
}

/// 落盘工作区列表。
pub fn save_workspaces(data: &WorkspacesFile) -> std::io::Result<()> {
    ensure_config_dir()?;
    let file = workspaces_file();
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(&file, json)
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionMeta>>,
}

impl SessionRegistry {
    pub fn register(&self, meta: SessionMeta) {
        let mut map = self.sessions.lock();
        // Dedupe:同一 (profileId, cliSessionId) 的 session 在表里只保留最新一条,
        // 避免反复 resume 时无限累积。
        if let Some(cli_id) = meta.cli_session_id.clone() {
            let dup_keys: Vec<String> = map
                .iter()
                .filter(|(_, m)| {
                    m.profile_id == meta.profile_id
                        && m.cli_session_id.as_deref() == Some(cli_id.as_str())
                        && m.id != meta.id
                })
                .map(|(k, _)| k.clone())
                .collect();
            for k in dup_keys {
                map.remove(&k);
            }
        }
        map.insert(meta.id.clone(), meta);
        drop(map);
        self.persist();
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        self.sessions.lock().values().cloned().collect()
    }

    pub fn remove(&self, id: &str) {
        self.sessions.lock().remove(id);
        self.persist();
    }

    /// 设置某 session 的 cliSessionId(detect 到之后写回持久化)。
    pub fn update_cli_session_id(&self, id: &str, cli_session_id: &str) {
        let mut map = self.sessions.lock();
        if let Some(meta) = map.get_mut(id) {
            meta.cli_session_id = Some(cli_session_id.to_string());
        }
        drop(map);
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
