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

/// 落盘设置(整棵写;前端 store 保证传入的是完整 settings 对象)。原子替换防截断。
pub fn save_settings(data: &serde_json::Value) -> std::io::Result<()> {
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    crate::session::write_json_atomic(&settings_file(), &json)
}

/// 会话置顶切换(app 设备窄写面):读改写仅 sessionPins 一个键。
/// 手机不持全量 settings 快照 —— 整树写会静默覆盖桌面并发修改,故不开
/// config_write_settings,只给这一把定向钥匙(key = wsId:profileId:cliSessionId)。
pub fn toggle_pin(key: &str, title: &str) -> Result<bool, String> {
    let mut data = load_settings();
    let root = data
        .as_object_mut()
        .ok_or_else(|| "settings.json 不是对象".to_string())?;
    let pins = root
        .entry("sessionPins")
        .or_insert_with(|| serde_json::Value::Object(Default::default()));
    let pins = pins
        .as_object_mut()
        .ok_or_else(|| "sessionPins 不是对象".to_string())?;
    let now_pinned = if pins.contains_key(key) {
        pins.remove(key);
        false
    } else {
        pins.insert(
            key.to_string(),
            serde_json::json!({
                "scope": "global",
                "pinnedAt": crate::now_millis(),
                "title": title,
            }),
        );
        true
    };
    save_settings(&serde_json::Value::Object(root.clone())).map_err(|e| e.to_string())?;
    Ok(now_pinned)
}
