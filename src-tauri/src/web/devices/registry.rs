//! DeviceRegistry —— 配对码与按 IP 节流(内存态;设备行持久化在父模块 devices)。
//! 从 devices.rs 按 300 行铁则拆出;经 `pub(crate) use registry::*` 再导出,
//! 消费面(devices::DeviceRegistry 等)不变。

use parking_lot::Mutex;

use super::{load_devices, sanitize_name, save_devices, sha256_hex, Device};
use crate::web::gate;

/// 配对码有效期(秒)。
pub(crate) const PAIR_TTL_SECS: u64 = 600;

/// 按来源 IP 的连续失败节流上限(达到即 429,成功清零)。
pub(crate) const PAIR_FAIL_LIMIT: u32 = 5;

/// 节流窗口(秒):距上次失败超过该窗,计数清零重计(修永久锁)。
pub(crate) const FAIL_WINDOW_SECS: u64 = 600;

pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
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

#[derive(Clone)]
struct FailEntry {
    count: u32,
    last_at: u64,
}

/// 共享注册表(挂在 AppState):配对码与节流计数是内存态,设备行每次读写盘。
#[derive(Default)]
pub(crate) struct DeviceRegistry {
    code: Mutex<Option<PairCode>>,
    fails: Mutex<std::collections::HashMap<String, FailEntry>>,
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

    /// 消费配对码:命中即清(单次);错码与过期区分。两侧哈希后再比,对齐 gate 加固纪律。
    pub fn consume_code(&self, supplied: &str, now: u64) -> Result<(), PairError> {
        let mut slot = self.code.lock();
        match slot.as_ref() {
            None => Err(PairError::BadCode),
            Some(pc) if sha256_hex(&pc.code) != sha256_hex(supplied) => Err(PairError::BadCode),
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

    /// 节流判定:距上次失败不足一个窗口期内的连续失败达到上限才拒;
    /// `127.0.0.1` = relay 回拨面(真源不可见),只计数告警不拒,防单点错码毒化全体 relay 配对。
    pub fn pair_denied(&self, ip: &str) -> bool {
        if ip == "127.0.0.1" {
            return false;
        }
        let map = self.fails.lock();
        match map.get(ip) {
            Some(e) if now_secs().saturating_sub(e.last_at) <= FAIL_WINDOW_SECS => {
                e.count >= PAIR_FAIL_LIMIT
            }
            _ => false,
        }
    }

    /// 记一次失败,返回当前计数(调用方在达到上限时发告警)。窗外重算。
    pub fn note_fail(&self, ip: &str) -> u32 {
        let mut map = self.fails.lock();
        // ponytail: 伪造源 IP 可撑大 map;超 1024 条整体清零,升级路径 = LRU
        if map.len() > 1024 {
            map.clear();
        }
        let now = now_secs();
        let e = map.entry(ip.to_string()).or_insert(FailEntry {
            count: 0,
            last_at: now,
        });
        if now.saturating_sub(e.last_at) > FAIL_WINDOW_SECS {
            e.count = 0; // 窗外从头计
        }
        e.count += 1;
        e.last_at = now;
        e.count
    }

    /// 成功配对清零。
    pub fn note_ok(&self, ip: &str) {
        self.fails.lock().remove(ip);
    }

    /// 配对:消费码 → 建 pending 设备 → 落盘;明文 token 只在此返回一次。
    pub fn pair(
        &self,
        dir: &std::path::Path,
        code: &str,
        device_name: &str,
        now: u64,
    ) -> Result<(String, String), PairError> {
        self.consume_code(code, now)?;
        let _io = super::io_lock();
        let device_id = gate::gen(16);
        let token = gate::gen(32);
        let mut all = load_devices(dir);
        // 顺手清掉超 24h 的历史 pending(被忽略的配对请求不无限累积)
        all.retain(|d| d.approved || now.saturating_sub(d.created_at) < 86_400);
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
