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

/// 设置文件写锁:桌面 config_merge_settings(锁内补丁合并)与桥 toggle_pin
/// (读改写)同进程串行化,防交叠写与 pin-vs-pin 丢更新(web/devices io_lock 同款纪律)。
static SETTINGS_IO: std::sync::LazyLock<parking_lot::Mutex<()>> =
    std::sync::LazyLock::new(|| parking_lot::Mutex::new(()));

/// 落盘设置(锁内;调用方须持 SETTINGS_IO)。原子替换防截断。
fn save_settings_locked(data: &serde_json::Value) -> std::io::Result<()> {
    ensure_config_dir()?;
    let json = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    crate::session::write_json_atomic(&settings_file(), &json)
}

/// 锁内读改写:与桌面补丁合并(config_merge_settings)及其他 RMW 写者
/// (relay/selfhost persist、toggle_pin)串行,消掉「load 在锁外的 stale 覆盖」窗口。
pub fn update_settings<R>(f: impl FnOnce(&mut serde_json::Value) -> R) -> Result<R, String> {
    let _io = SETTINGS_IO.lock();
    let mut data = load_settings();
    if !data.is_object() {
        data = serde_json::json!({});
    }
    let out = f(&mut data);
    save_settings_locked(&data).map_err(|e| format!("设置落盘失败: {e}"))?;
    Ok(out)
}

/// 前端补丁写(顶层键合并):patch 只携带被改域,落盘时与其余域合流 ——
/// 整树覆盖写会把 Rust 直写盘(web_relay 回填 webAccessEnabled、selfhost
/// persist)与他实例刚落的键砸回内存旧值(00d3dc5「绿灯但桥死」竞态),
/// 补丁写让陈旧域根本不上线,该 bug 类从机制上消失。
/// 返回合并后整树,供命令层跑 proxy/web 跟随钩子。非对象 patch 拒写。
pub fn merge_settings(patch: &serde_json::Value) -> Result<serde_json::Value, String> {
    if !patch.is_object() {
        return Err("设置补丁必须是对象".into());
    }
    let mut merged = serde_json::Value::Null;
    update_settings(|data| {
        if let (Some(dst), Some(src)) = (data.as_object_mut(), patch.as_object()) {
            for (k, v) in src {
                dst.insert(k.clone(), v.clone());
            }
        }
        merged = data.clone();
    })?;
    Ok(merged)
}

/// 会话置顶切换(app 设备窄写面):读改写仅 sessionPins 一个键。
/// 手机不持全量 settings 快照,也不给 config_merge_settings ——
/// 只给这一把定向钥匙(key = wsId:profileId:cliSessionId)。
pub fn toggle_pin(key: &str, title: &str) -> Result<bool, String> {
    let _io = SETTINGS_IO.lock(); // 读改写全程持锁:与补丁合并及其他 RMW 写者串行
    let key = truncate_boundary(key, 512);
    let title = truncate_boundary(title, 256);
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
    save_settings_locked(&serde_json::Value::Object(root.clone())).map_err(|e| e.to_string())?;
    Ok(now_pinned)
}

/// 按字节上限截到字符边界(MSRV 1.80;str::floor_char_boundary 1.91 才稳定)。
fn truncate_boundary(s: &str, max: usize) -> &str {
    if s.len() <= max {
        s
    } else {
        let mut i = max;
        while !s.is_char_boundary(i) {
            i -= 1;
        }
        &s[..i]
    }
}
