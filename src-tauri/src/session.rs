//! 会话注册表：Session = 1 CLI profile + 1 PTY + CLI 自身 session id（第六轮决策）。
//!
//! 骨架阶段：仅落内存表，持久化（CLI 会话恢复映射）后续补。

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, SessionMeta>>,
}

impl SessionRegistry {
    pub fn register(&self, meta: SessionMeta) {
        self.sessions.lock().insert(meta.id.clone(), meta);
    }

    pub fn list(&self) -> Vec<SessionMeta> {
        self.sessions.lock().values().cloned().collect()
    }

    pub fn remove(&self, id: &str) {
        self.sessions.lock().remove(id);
    }
}
