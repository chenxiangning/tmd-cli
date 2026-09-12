//! 会话注册表 —— 纯内存活会话表（1 活会话 = 1 CLI profile + 1 PTY）。
//!
//! 设计决策:tmd-cli 不做会话映射持久化。
//! 历史会话由各 CLI 插件从自己的磁盘存储扫描(omp/pi 的 jsonl 目录、
//! codex 的 rollout 目录),本注册表只跟踪当前进程内活着的 PTY。
//! 工作区元数据仍持久化到 `~/.tmd-cli/workspaces.json`。

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
    /// 所属工作区 id。
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// 创建时间 ms epoch。
    #[serde(default)]
    pub created_at: u64,
    pub pid: Option<u32>,
    /// 会话后端类型:"cli"(本地 PTY,缺省)| "ssh"(russh 引擎)。
    #[serde(default = "default_session_kind")]
    pub kind: String,
    /// 会话展示标题(SSH 会话 = 主机名;CLI 会话由磁盘会话/命名覆盖层供给,缺省 None)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 引擎档案 id(仅 SSH 会话:WSL CLI 会话在远端跑某引擎,composer/Ask 据此
    /// 取 CLI profile;kind 仍为 "ssh",传输语义不变)。普通 SSH/本地会话 = None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
}

fn default_session_kind() -> String {
    "cli".to_string()
}

/// 工作区元数据。持久化到 `~/.tmd-cli/workspaces.json`。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    pub root: String,
    pub created_at: u64,
    /// 所属工作区分组 id(分组定义在前端 settings.json;None/缺省 = 未分组)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    /// 显示名覆盖(显示层语义,身份仍看 id/root;None/缺省 = 显示目录名)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    /// WSL 工作区元数据(None/缺省 = 本地目录工作区):distro = 发行版名;
    /// host_id = 远程 SSH 主机 id(settings.ssh.hosts;None = 本机 wsl.exe,
    /// root 为 \\wsl.localhost UNC 形态)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl: Option<WorkspaceWslMeta>,
}

/// WSL 工作区元数据(WorkspaceMeta.wsl)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWslMeta {
    pub distro: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
}

/// workspaces.json 顶层结构。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct WorkspacesFile {
    #[serde(default)]
    pub list: Vec<WorkspaceMeta>,
    #[serde(default)]
    pub active_id: Option<String>,
}

/// 用户 home 目录(mac/win 兼容)。极端环境取不到时退到临时目录。
pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir)
}

/// 用户全局配置目录: `~/.tmd-cli/`。所有客户端本地数据落此。
pub fn config_dir() -> PathBuf {
    home_dir().join(".tmd-cli")
}

/// 默认工作区根目录: `~/.tmd-cli/default`。首次调用确保目录存在。
pub fn default_workspace_root() -> PathBuf {
    let dir = config_dir().join("default");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 配置目录下 workspaces 持久化文件路径。
pub fn workspaces_file() -> PathBuf {
    config_dir().join("workspaces.json")
}

/// 确保 `~/.tmd-cli/` 目录存在。
pub fn ensure_config_dir() -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir())
}

/// 读取工作区列表。文件不存在返回空结构。
pub fn load_workspaces() -> WorkspacesFile {
    let file = workspaces_file();
    match std::fs::read_to_string(&file) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => WorkspacesFile::default(),
    }
}

/// 同目录临时文件 + rename 的原子替换:进程崩溃/掉电不会留下截断的 JSON。
/// rename 在同一文件系统内原子;load 侧失败本就回退默认,损坏不再不可逆。
pub(crate) fn write_json_atomic(path: &std::path::Path, json: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

/// 落盘工作区列表。
pub fn save_workspaces(data: &WorkspacesFile) -> std::io::Result<()> {
    ensure_config_dir()?;
    let file = workspaces_file();
    let json = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    write_json_atomic(&file, &json)
}

/// 活会话注册表。进程内存态,不落盘;PTY 退出即移除。
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
