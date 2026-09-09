//! 本地插件版本库原语(经 plugins.rs 内 #[path] 引入为 versions 模块):
//! 归档 / 淘汰 / 回退 / 版本文件读取。版本文件名 = `{version}-{hash8}.js`
//! (version 经字符白名单净化,hash8 = 入口内容 SHA-256 前 8 位,信任闸同判据)。

use super::*;

/// 读版本库单文件(.versions/<file>)。
pub fn read_version_file(root: &Path, id: &str, file: &str) -> Result<String, String> {
    if !valid_name(file) {
        return Err(format!("非法版本文件名: {file}"));
    }
    let p = resolve_dir(root, id)?.join(".versions").join(file);
    read_limited(root, &p)
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

pub(crate) fn version_file_name(version: &str, sha256: &str) -> String {
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
    // 同内容换过版本号名(老版回退不对齐 manifest 时期产生的错位条目)也视为已归档:
    // 版本号段只是归档当时的 manifest 值,内容才是身份,杜绝「0.2.0-<0.1.0hash>」类孤儿条目新增。
    if collect_stamps(root, &vdir, false)
        .iter()
        .any(|s| s.sha256 == sha256)
    {
        return Ok(None);
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

/// 从版本文件名 `{version}-{hash8}.js` 解出版本号(hash8 须为 8 位十六进制,防误切)。
fn version_of_file_name(file: &str) -> Option<&str> {
    let stem = file.strip_suffix(".js")?;
    let (version, hash8) = stem.rsplit_once('-')?;
    if !version.is_empty() && hash8.len() == 8 && hash8.bytes().all(|b| b.is_ascii_hexdigit()) {
        Some(version)
    } else {
        None
    }
}

/// 把 plugin.json 的 version 字段改写为指定值(其余字段原样保留,整体转 pretty 布局)。
fn align_manifest_version(dir: &Path, version: &str) -> Result<(), String> {
    let path = dir.join("plugin.json");
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 plugin.json 失败: {e}"))?;
    let mut v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("plugin.json 非法 JSON: {e}"))?;
    v["version"] = version.into();
    let out =
        serde_json::to_string_pretty(&v).map_err(|e| format!("序列化 plugin.json 失败: {e}"))?;
    fs::write(&path, out).map_err(|e| format!("回写 plugin.json 失败: {e}"))
}

/// 回退:先把当前版归档进版本库(永不丢当前版),再把指定版本换回入口;
/// 并把 plugin.json 的 version 对齐到回退版(否则扫描清单的版本号滞留在回退前)。
pub fn rollback(root: &Path, id: &str, file: &str) -> Result<(), String> {
    archive_current(root, id)?;
    let dir = resolve_dir(root, id)?;
    let (entry, _) = manifest_entry_version(root, id)?;
    let content = read_version_file(root, id, file)?;
    fs::write(dir.join(&entry), content).map_err(|e| format!("回退写入失败: {e}"))?;
    if let Some(version) = version_of_file_name(file) {
        align_manifest_version(&dir, version)?;
    }
    Ok(())
}
