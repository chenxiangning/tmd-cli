//! SSH known_hosts —— `~/.tmd-cli/ssh_known_hosts.json` 的键值存储。
//! 参考实现 用 SQLite;本仓配置文件全 JSON + 原子写原语,单表不值得进库。

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::session::{config_dir, write_json_atomic};
use parking_lot::Mutex;

/// 一条已信任的 host key(host+port 唯一)。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostKey {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub key_base64: String,
    /// 形如 "SHA256:xxxx"(russh fingerprint 格式)。
    pub fingerprint_sha256: String,
    #[serde(default)]
    pub trusted_at: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum KnownHostStatus {
    /// 库里没有该主机 → 首连信任流。
    Unknown,
    /// 指纹或 key 匹配 → 直接放行。
    Known,
    /// 指纹不匹配 → 危险提示(中间人可能)。
    Changed { stored_fingerprint: String },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct KnownHostsFile {
    hosts: BTreeMap<String, KnownHostKey>,
}

fn known_hosts_path() -> std::path::PathBuf {
    config_dir().join("ssh_known_hosts.json")
}

fn entry_key(host: &str, port: u16) -> String {
    format!("{}:{}", host.trim(), port)
}

fn load_file() -> KnownHostsFile {
    let path = known_hosts_path();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return KnownHostsFile::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// 进程级缓存 + 落盘串行化(读多写少;写仅信任/重置)。
static STORE: Mutex<Option<Arc<KnownHostsFile>>> = Mutex::new(None);

fn with_store<T: Clone>(f: impl FnOnce(&KnownHostsFile) -> T) -> T {
    let mut guard = STORE.lock();
    if guard.is_none() {
        *guard = Some(Arc::new(load_file()));
    }
    f(guard.as_ref().expect("known_hosts store 已初始化"))
}

fn persist(next: KnownHostsFile) -> Result<(), String> {
    let path = known_hosts_path();
    let json = serde_json::to_string_pretty(&next)
        .map_err(|error| format!("序列化 known_hosts 失败: {error}"))?;
    write_json_atomic(&path, &json).map_err(|error| format!("写入 known_hosts 失败: {error}"))?;
    *STORE.lock() = Some(Arc::new(next));
    Ok(())
}

/// 校验 host key:Known 直接放行;Unknown/Changed 交前端信任流。
pub fn check(key: &KnownHostKey) -> Result<KnownHostStatus, String> {
    Ok(with_store(|store| {
        let Some(stored) = store.hosts.get(&entry_key(&key.host, key.port)) else {
            return KnownHostStatus::Unknown;
        };
        if stored.key_base64 == key.key_base64
            || stored.fingerprint_sha256 == key.fingerprint_sha256
        {
            KnownHostStatus::Known
        } else {
            KnownHostStatus::Changed {
                stored_fingerprint: stored.fingerprint_sha256.clone(),
            }
        }
    }))
}

/// 信任(或更新)一条 host key。upsert 语义,与 参考实现 SQL upsert 一致。
pub fn trust(key: &KnownHostKey) -> Result<(), String> {
    let mut next = with_store(|store| store.clone());
    let mut entry = key.clone();
    entry.host = entry.host.trim().to_string();
    entry.trusted_at = now_millis();
    next.hosts.insert(entry_key(&entry.host, entry.port), entry);
    persist(next)
}

/// 重置某主机的信任(设置页「忘记此主机」);返回是否存在过。
pub fn reset(host: &str, port: u16) -> Result<bool, String> {
    let mut next = with_store(|store| store.clone());
    let existed = next.hosts.remove(&entry_key(host, port)).is_some();
    if existed {
        persist(next)?;
    }
    Ok(existed)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_key(fingerprint: &str) -> KnownHostKey {
        KnownHostKey {
            host: "prod.example.com".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            key_base64: "AAAAC3NzaC1lZDI1NTE5AAAAI".into(),
            fingerprint_sha256: fingerprint.into(),
            trusted_at: 0,
        }
    }

    /* check/trust 走进程缓存与真实 ~/.tmd-cli 路径,单测不能污染用户数据:
    直接测纯逻辑部分(序列化/键名),存储路径行为靠端到端验证。 */
    #[test]
    fn entry_key_format() {
        assert_eq!(entry_key(" host.example ", 22), "host.example:22");
    }

    #[test]
    fn file_roundtrip() {
        let mut file = KnownHostsFile::default();
        file.hosts
            .insert(entry_key("a.example", 22), sample_key("SHA256:aaa"));
        let json = serde_json::to_string(&file).unwrap();
        let parsed: KnownHostsFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.hosts.len(), 1);
        assert_eq!(
            parsed
                .hosts
                .get(&entry_key("a.example", 22))
                .unwrap()
                .fingerprint_sha256,
            "SHA256:aaa"
        );
    }

    #[test]
    fn corrupted_file_parses_to_default() {
        let parsed: KnownHostsFile = serde_json::from_str("{oops").unwrap_or_default();
        assert!(parsed.hosts.is_empty());
    }
}
