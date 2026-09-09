//! 本地插件目录(`~/.tmd-cli/plugins/`)的通用文件原语。
//! 安全面:renderer 不可信,一切路径锁死在 plugins 根下,id/文件名白名单字符,拒绝目录穿越
//! 与符号链接逃逸(仅查 root 以下分量:macOS /var→/private/var 等系统级祖先软链合法)。
//! 内容指纹用 SHA-256(信任闸判据,抗 AI 选择前缀碰撞)。通用原语零插件业务知识。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 读入上限:与 fs_edit 写上限对齐,防恶意/异常 bundle 爆内存。
const MAX_READ_BYTES: u64 = 16 * 1024 * 1024;
/// 版本库保留份数,超出淘汰最旧(按文件 mtime)。
const VERSIONS_KEEP: usize = 5;

pub fn plugins_root() -> PathBuf {
    crate::session::config_dir().join("plugins")
}

/// 单文件元数据:名字 + 内容 SHA-256(变更检测与信任闸判据)+ 大小 + mtime(版本库排序)。
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct PluginFileStamp {
    pub name: String,
    pub sha256: String,
    pub size: u64,
    pub modified_ms: u64,
}

/// 一个插件目录的扫描结果;坏目录不跳过而以 error 条目返回,前端落「加载失败」。
#[derive(Serialize, Debug, PartialEq)]
pub struct PluginScanEntry {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<serde_json::Value>,
    pub files: Vec<PluginFileStamp>,
    pub versions: Vec<PluginFileStamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Windows 保留设备名(不分大小写),作 id/文件名时在 Windows 上指向设备而非文件。
const WINDOWS_RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn valid_name(s: &str) -> bool {
    if s.is_empty()
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        || s == "."
        || s == ".."
    {
        return false;
    }
    !WINDOWS_RESERVED.contains(&s.to_ascii_lowercase().as_str())
}

fn resolve_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_name(id) {
        return Err(format!("非法插件 id: {id}"));
    }
    Ok(root.join(id))
}

/// 检查 root 之下的路径分量是否含符号链接(root 自身祖先链不管 —— macOS /var→/private/var
/// 这类系统级软链合法)。防御深度:防 plugins 内软链把 ~/.ssh 等内容读进 renderer。
fn links_symlink_under(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return true;
    };
    let mut cur = root.to_path_buf();
    for comp in rel.components() {
        cur.push(comp);
        if let Ok(meta) = fs::symlink_metadata(&cur) {
            if meta.file_type().is_symlink() {
                return true;
            }
        }
    }
    false
}

fn stamp(_root: &Path, path: &Path, name: String) -> Result<PluginFileStamp, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取元数据失败 {name}: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        // 超限文件不读不入清单:免信任的扫描路径绝不允许被大文件拖进内存
        return Err(format!("文件超过 16MB 上限,已跳过: {name}"));
    }
    let bytes = fs::read(path).map_err(|e| format!("读取失败 {name}: {e}"))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(PluginFileStamp {
        name,
        sha256: crate::hash::sha256_hex(&String::from_utf8_lossy(&bytes)),
        size: meta.len(),
        modified_ms,
    })
}

fn collect_stamps(root: &Path, dir: &Path, skip_dirs: bool) -> Vec<PluginFileStamp> {
    let mut out: Vec<PluginFileStamp> = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if links_symlink_under(root, &p) {
            continue;
        }
        if p.is_dir() && skip_dirs {
            continue;
        }
        if p.is_file() {
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                if let Ok(s) = stamp(root, &p, name.to_string()) {
                    out.push(s);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 扫描插件根:无目录/空目录返回空清单(零影响承诺);缺 plugin.json 的目录跳过;
/// manifest 非法 JSON 或 id 与目录名不一致 → error 条目(不静默丢,前端可见)。
pub fn scan_plugins(root: &Path) -> Result<Vec<PluginScanEntry>, String> {
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    let rd = fs::read_dir(root).map_err(|e| format!("扫描插件目录失败: {e}"))?;
    for ent in rd.flatten() {
        let dir = ent.path();
        if !dir.is_dir() || links_symlink_under(root, &dir) {
            continue;
        }
        let Some(id) = dir.file_name().and_then(|n| n.to_str()).map(str::to_string) else {
            continue;
        };
        if id.starts_with('.') || !valid_name(&id) {
            continue;
        }
        let manifest_path = dir.join("plugin.json");
        if !manifest_path.is_file() {
            continue; // 非插件目录(如无 manifest 的杂物目录)跳过
        }
        let entry = match read_manifest(root, &manifest_path, &id) {
            Ok(manifest) => PluginScanEntry {
                id: id.clone(),
                manifest: Some(manifest),
                files: collect_stamps(root, &dir, true),
                versions: collect_stamps(root, &dir.join(".versions"), false),
                error: None,
            },
            Err(e) => PluginScanEntry {
                id,
                manifest: None,
                files: vec![],
                versions: vec![],
                error: Some(e),
            },
        };
        out.push(entry);
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn read_manifest(root: &Path, path: &Path, dir_id: &str) -> Result<serde_json::Value, String> {
    let text = read_limited(root, path).map_err(|e| format!("读取 plugin.json 失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("plugin.json 非法 JSON: {e}"))?;
    let mid = v.get("id").and_then(|x| x.as_str()).unwrap_or("");
    if mid != dir_id {
        return Err(format!("manifest id({mid})与目录名({dir_id})不一致"));
    }
    Ok(v)
}

/// 读插件目录顶层单文件(entry)。文件名白名单字符,拒绝任何路径分隔与符号链接。
pub fn read_plugin_file(root: &Path, id: &str, name: &str) -> Result<String, String> {
    if !valid_name(name) {
        return Err(format!("非法文件名: {name}"));
    }
    let p = resolve_dir(root, id)?.join(name);
    read_limited(root, &p)
}

/// 读版本库单文件(.versions/<file>)。
pub fn read_version_file(root: &Path, id: &str, file: &str) -> Result<String, String> {
    if !valid_name(file) {
        return Err(format!("非法版本文件名: {file}"));
    }
    let p = resolve_dir(root, id)?.join(".versions").join(file);
    read_limited(root, &p)
}

fn read_limited(root: &Path, p: &Path) -> Result<String, String> {
    if links_symlink_under(root, p) {
        return Err("拒绝读取符号链接".into());
    }
    let meta = fs::metadata(p).map_err(|e| format!("文件不存在或不可读: {e}"))?;
    if meta.len() > MAX_READ_BYTES {
        return Err(format!("文件超过 16MB 上限({}字节)", meta.len()));
    }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {e}"))
}

/// 卸载本地插件:插件目录整体移入系统废纸篓(路径 Rust 侧锁死,前端只传 id,不传路径)。
pub fn trash_plugin(root: &Path, id: &str) -> Result<(), String> {
    let dir = resolve_dir(root, id)?;
    if !dir.is_dir() {
        return Err(format!("插件目录不存在: {id}"));
    }
    crate::fs_edit::trash_entry(&dir.to_string_lossy())
}

fn manifest_entry_version(root: &Path, id: &str) -> Result<(String, String), String> {
    let manifest = read_manifest(root, &resolve_dir(root, id)?.join("plugin.json"), id)?;
    let entry = manifest
        .get("entry")
        .and_then(|x| x.as_str())
        .unwrap_or("index.js")
        .to_string();
    if !valid_name(&entry) {
        return Err(format!("非法入口名: {entry}"));
    }
    let version = manifest
        .get("version")
        .and_then(|x| x.as_str())
        .unwrap_or("0.0.0")
        .to_string();
    Ok((entry, version))
}

fn version_file_name(version: &str, sha256: &str) -> String {
    let v: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{v}-{}.js", &sha256[..8])
}

/// 把当前入口 bundle 归档进 .versions(同内容按指纹去重),淘汰到保留上限。
/// 返回归档文件名;内容未变化(已存在同指纹文件)返回 None。
pub fn archive_current(root: &Path, id: &str) -> Result<Option<String>, String> {
    let dir = resolve_dir(root, id)?;
    let (entry, version) = manifest_entry_version(root, id)?;
    let content = read_limited(root, &dir.join(&entry))?;
    let sha256 = crate::hash::sha256_hex(&content);
    let name = version_file_name(&version, &sha256);
    let vdir = dir.join(".versions");
    if vdir.join(&name).is_file() {
        return Ok(None); // 同内容已归档
    }
    fs::create_dir_all(&vdir).map_err(|e| format!("创建版本库失败: {e}"))?;
    fs::write(vdir.join(&name), content).map_err(|e| format!("归档失败: {e}"))?;
    prune_versions(root, &vdir)?;
    Ok(Some(name))
}

fn prune_versions(root: &Path, vdir: &Path) -> Result<(), String> {
    let mut stamps = collect_stamps(root, vdir, false);
    stamps.sort_by_key(|s| s.modified_ms);
    while stamps.len() > VERSIONS_KEEP {
        let victim = stamps.remove(0);
        fs::remove_file(vdir.join(&victim.name)).map_err(|e| format!("淘汰旧版本失败: {e}"))?;
    }
    Ok(())
}

/// 回退:先把当前版归档进版本库(永不丢当前版),再把指定版本换回入口。
pub fn rollback(root: &Path, id: &str, file: &str) -> Result<(), String> {
    archive_current(root, id)?;
    let dir = resolve_dir(root, id)?;
    let (entry, _) = manifest_entry_version(root, id)?;
    let content = read_version_file(root, id, file)?;
    fs::write(dir.join(&entry), content).map_err(|e| format!("回退写入失败: {e}"))
}

#[path = "plugins_cmds.rs"]
mod cmds;
pub(crate) use cmds::*;
#[cfg(test)]
#[path = "plugins_tests.rs"]
mod tests;
