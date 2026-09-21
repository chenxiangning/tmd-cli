//! 设备注册表:已配对手机/平板的身份与凭据(落盘只存 sha-256,永不存明文 token)。
//! 文件:`~/.tmd-cli/web_devices.json`(0600);hostId:`~/.tmd-cli/web_host_id`(一次性)。
//! 配对码为进程内存态:桌面重启即失效,与 10min TTL 单次消费语义一致。

use crate::session::{config_dir, write_json_atomic};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

use super::gate;

/// 配对码有效期(秒)。
pub(crate) const PAIR_TTL_SECS: u64 = 600;

/// 按来源 IP 的连续失败节流上限(达到即 429,成功清零)。
pub(crate) const PAIR_FAIL_LIMIT: u32 = 5;

pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

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

#[derive(Debug, PartialEq)]
pub(crate) enum PairError {
    BadCode,
    Expired,
    Storage,
}

struct PairCode {
    code: String,
    expires_at: u64,
}

/// 共享注册表(挂在 AppState):配对码与节流计数是内存态,设备行每次读写盘。
#[derive(Default)]
pub(crate) struct DeviceRegistry {
    code: Mutex<Option<PairCode>>,
    fails: Mutex<std::collections::HashMap<String, u32>>,
}

pub(crate) fn devices_path(dir: &Path) -> std::path::PathBuf {
    dir.join("web_devices.json")
}

fn host_id_path(dir: &Path) -> std::path::PathBuf {
    dir.join("web_host_id")
}

fn sha256_hex(s: &str) -> String {
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
    serde_json::from_str::<DeviceFile>(&text)
        .map(|f| f.devices)
        .unwrap_or_default()
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

impl DeviceRegistry {
    /// 铸配对码(单在售:再铸即作废旧码),返回 (code, expires_at)。
    pub fn mint_code(&self, now: u64) -> (String, u64) {
        let code = format!("{}-{}", gate::gen(4), gate::gen(4));
        let expires_at = now + PAIR_TTL_SECS;
        *self.code.lock() = Some(PairCode {
            code: code.clone(),
            expires_at,
        });
        (code, expires_at)
    }

    /// 消费配对码:命中即清(单次);错码与过期区分。
    pub fn consume_code(&self, supplied: &str, now: u64) -> Result<(), PairError> {
        let mut slot = self.code.lock();
        match slot.as_ref() {
            None => Err(PairError::BadCode),
            Some(pc) if pc.code != supplied => Err(PairError::BadCode),
            Some(pc) if now > pc.expires_at => {
                *slot = None;
                Err(PairError::Expired)
            }
            Some(_) => {
                *slot = None;
                Ok(())
            }
        }
    }

    /// 节流判定:连续失败达到上限的来源 IP 直接拒。
    pub fn pair_denied(&self, ip: &str) -> bool {
        self.fails.lock().get(ip).copied().unwrap_or(0) >= PAIR_FAIL_LIMIT
    }

    /// 记一次失败,返回当前计数(调用方在达到上限时发告警)。
    pub fn note_fail(&self, ip: &str) -> u32 {
        let mut map = self.fails.lock();
        // ponytail: 无时间窗衰减,伪造源 IP 可撑大 map;超 1024 条整体清零,升级路径 = LRU
        if map.len() > 1024 {
            map.clear();
        }
        let count = map.entry(ip.to_string()).or_insert(0);
        *count += 1;
        *count
    }

    /// 成功配对清零。
    pub fn note_ok(&self, ip: &str) {
        self.fails.lock().remove(ip);
    }

    /// 配对:消费码 → 建 pending 设备 → 落盘;明文 token 只在此返回一次。
    pub fn pair(
        &self,
        dir: &Path,
        code: &str,
        device_name: &str,
        now: u64,
    ) -> Result<(String, String), PairError> {
        self.consume_code(code, now)?;
        let device_id = gate::gen(16);
        let token = gate::gen(32);
        let mut all = load_devices(dir);
        all.push(Device {
            device_id: device_id.clone(),
            name: sanitize_name(device_name),
            token_hash: sha256_hex(&token),
            created_at: now,
            last_seen_at: now,
            approved: false,
        });
        save_devices(dir, &all).map_err(|_| PairError::Storage)?;
        Ok((device_id, token))
    }
}

/// 批准 pending 设备(幂等);返回是否真的存在该设备。
pub(crate) fn approve(dir: &Path, device_id: &str, now: u64) -> bool {
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

/// 双凭据校验:device_id + token 哈希比对 + 已批准。失败一律 None,不区分原因。
pub(crate) fn validate(dir: &Path, device_id: &str, token: &str) -> Option<Device> {
    let hash = sha256_hex(token);
    load_devices(dir)
        .into_iter()
        .find(|d| d.device_id == device_id && d.token_hash == hash && d.approved)
}

/// 连接维持期复查:设备行仍存在且已批准(撤销/删除即断)。
pub(crate) fn is_approved(dir: &Path, device_id: &str) -> bool {
    load_devices(dir)
        .iter()
        .any(|d| d.device_id == device_id && d.approved)
}

/// 连接即刷新 last_seen(连接级,非每消息)。
pub(crate) fn touch_last_seen(dir: &Path, device_id: &str, now: u64) {
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
