//! 设备注册表:已配对手机/平板的身份与凭据(落盘只存 sha-256,永不存明文 token)。
//! 文件:`~/.tmd-cli/web_devices.json`(0600);hostId:`~/.tmd-cli/web_host_id`(一次性)。
//! 配对码为进程内存态:桌面重启即失效,与 10min TTL 单次消费语义一致。
//! 本模块 = 设备行持久化(store)+ 重导出 registry(配对码/节流,./registry.rs)。

mod registry;

#[cfg(test)]
pub(crate) use registry::PAIR_TTL_SECS;
pub(crate) use registry::{now_secs, DeviceRegistry, PairError, PAIR_FAIL_LIMIT};

use crate::session::{config_dir, write_json_atomic};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Device {
    pub device_id: String,
    pub name: String,
    /// sha-256 hex;明文 token 只在 /pair 应答里出现一次。
    pub token_hash: String,
    pub created_at: u64,
    pub last_seen_at: u64,
    pub approved: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct DeviceFile {
    version: u32,
    devices: Vec<Device>,
}

pub(crate) fn devices_path(dir: &Path) -> std::path::PathBuf {
    dir.join("web_devices.json")
}

fn host_id_path(dir: &Path) -> std::path::PathBuf {
    dir.join("web_host_id")
}

pub(crate) fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    let out = h.finalize();
    out.iter().map(|b| format!("{b:02x}")).collect()
}

/// 展示名收紧:去空白、截 40 字符、空则兜底;纯展示不参与路径。
pub(crate) fn sanitize_name(raw: &str) -> String {
    let trimmed: String = raw.trim().chars().take(40).collect();
    if trimmed.is_empty() {
        "iPhone".into()
    } else {
        trimmed
    }
}

fn set_owner_only(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
}

pub(crate) fn load_devices(dir: &Path) -> Vec<Device> {
    let Ok(text) = std::fs::read_to_string(devices_path(dir)) else {
        return Vec::new();
    };
    match serde_json::from_str::<DeviceFile>(&text) {
        Ok(f) => f.devices,
        Err(_) => {
            /* 坏文件保留待查(.corrupt),不静默覆没——否则首次写盘即抹掉全部已配对设备。 */
            let corrupt = devices_path(dir).with_extension("json.corrupt");
            let _ = std::fs::rename(devices_path(dir), &corrupt);
            eprintln!("[web] 设备表损坏,原文件保留至 {}", corrupt.display());
            Vec::new()
        }
    }
}

pub(crate) fn save_devices(dir: &Path, devices: &[Device]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let file = DeviceFile {
        version: 1,
        devices: devices.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
    write_json_atomic(&devices_path(dir), &json)?;
    set_owner_only(&devices_path(dir));
    Ok(())
}

/// hostId:16 字节随机 hex,首次生成后固定(一次性身份,配对 offer 携带)。
pub(crate) fn host_id(dir: &Path) -> String {
    let path = host_id_path(dir);
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim();
        if s.len() == 32 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            return s.to_string();
        }
    }
    let bytes: [u8; 16] = rand::random();
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let _ = std::fs::create_dir_all(dir);
    if write_json_atomic(&path, &hex).is_ok() {
        set_owner_only(&path);
    }
    hex
}

/// 设备表 load→改→save 串行锁:atomic 写只防撕裂不防丢更新;
/// approve/revoke/pair/touch_last_seen 全部经此互斥(review F10)。
pub(crate) fn io_lock() -> parking_lot::MutexGuard<'static, ()> {
    static IO_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());
    IO_LOCK.lock()
}

/// 批准 pending 设备(幂等);返回是否真的存在该设备。
pub(crate) fn approve(dir: &Path, device_id: &str, now: u64) -> bool {
    let _io = io_lock();
    let mut all = load_devices(dir);
    let mut hit = false;
    for d in &mut all {
        if d.device_id == device_id {
            d.approved = true;
            d.last_seen_at = now;
            hit = true;
        }
    }
    hit && save_devices(dir, &all).is_ok()
}

/// 撤销(删除行 + 即时踢既有连接);返回是否删了东西。
pub(crate) fn revoke(dir: &Path, device_id: &str) -> bool {
    let _io = io_lock();
    let mut all = load_devices(dir);
    let before = all.len();
    all.retain(|d| d.device_id != device_id);
    if all.len() == before {
        return false;
    }
    let ok = save_devices(dir, &all).is_ok();
    super::conn::kick(device_id);
    ok
}

/// 双凭据校验:device_id + token 哈希比对(**不论批准态**,approved 由调用方分流
/// pending/rejected)。凭据不匹配一律 None。
pub(crate) fn find_by_credentials(dir: &Path, device_id: &str, token: &str) -> Option<Device> {
    let hash = sha256_hex(token);
    load_devices(dir)
        .into_iter()
        .find(|d| d.device_id == device_id && d.token_hash == hash)
}

/// 连接维持期复查:设备行仍存在且已批准(撤销/删除即断)。
pub(crate) fn is_approved(dir: &Path, device_id: &str) -> bool {
    load_devices(dir)
        .iter()
        .any(|d| d.device_id == device_id && d.approved)
}

/// 连接即刷新 last_seen(连接级,非每消息)。
pub(crate) fn touch_last_seen(dir: &Path, device_id: &str, now: u64) {
    let _io = io_lock();
    let mut all = load_devices(dir);
    for d in &mut all {
        if d.device_id == device_id {
            d.last_seen_at = now;
        }
    }
    let _ = save_devices(dir, &all);
}

/// 命令面/WS 用:配置目录下的设备注册表根。
pub(crate) fn devices_dir() -> std::path::PathBuf {
    config_dir()
}
