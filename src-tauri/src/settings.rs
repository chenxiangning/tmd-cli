//! 全局设置持久化 —— `~/.tmd-cli/settings.json`。
//!
//! 设计决策:Rust 侧不感知设置 schema,只做 serde_json::Value 透传。
//! 字段定义、默认值、sanitize 全部归前端 kernel/settings.ts ——
//! 设置项演进(新 section/新字段)不需要动 Rust,插件化扩展零后端成本。

use std::path::PathBuf;

use crate::session::{config_dir, ensure_config_dir};

/// 设置持久化文件路径。
fn settings_file() -> PathBuf {
    config_dir().join("settings.json")
}

/// 读取设置。文件不存在/解析失败返回 Null(前端按默认值启动)。
pub fn load_settings() -> serde_json::Value {
    match std::fs::read_to_string(settings_file()) {
        Ok(content) => serde_json::from_str(&content).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

/// 落盘设置(整棵写;前端 store 保证传入的是完整 settings 对象)。
pub fn save_settings(data: &serde_json::Value) -> std::io::Result<()> {
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    std::fs::write(settings_file(), json)
}
