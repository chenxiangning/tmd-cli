//! 文件系统服务：喂右侧文件树 + composer 的 @ 补全。
//!
//! 骨架阶段：单层目录列举。递归/监听/忽略规则随 files 插件实装时补。

use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列举一层目录（隐藏文件默认过滤，目录排前）。
pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|e| format!("读取目录失败: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(DirEntry {
                name,
                path: entry.path().to_string_lossy().to_string(),
                is_dir,
            })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(entries)
}
const MAX_PREVIEW_BYTES: u64 = 512 * 1024;

/// 读取文本文件内容供前端预览。超限/二进制直接拒绝。
pub fn read_file(path: &str) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if meta.len() > MAX_PREVIEW_BYTES {
        return Err(format!("文件超过 {}KB，暂不支持预览", MAX_PREVIEW_BYTES / 1024));
    }
    let bytes = fs::read(path).map_err(|e| format!("读取文件失败: {e}"))?;
    if bytes.contains(&0) {
        return Err("二进制文件暂不支持预览".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "非 UTF-8 文本，暂不支持预览".to_string())
}

/// 把字节写入临时目录(用户上传的图片/截图)。返回绝对路径。
pub fn write_temp_file(name: &str, bytes: &[u8]) -> Result<String, String> {
    let base = std::env::temp_dir().join("tmd-cli");
    fs::create_dir_all(&base).map_err(|e| format!("创建临时目录失败: {e}"))?;
    // 从 name 抽扩展名(空则 bin)
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| if e.len() <= 5 && !e.is_empty() { e } else { "bin" })
        .unwrap_or("bin");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = base.join(format!("upload-{stamp}.{ext}"));
    fs::write(&path, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}


