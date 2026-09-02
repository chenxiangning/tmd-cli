//! 文件系统服务：喂右侧文件树 + composer 的 @ 补全。
//!
//! 骨架阶段：单层目录列举。递归/监听/忽略规则随 files 插件实装时补。

use std::time::{SystemTime, UNIX_EPOCH};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// 列举一层目录（目录排前）。过滤语义照抄 codemoss：
/// 仅跳过 `.git` 目录与 `.DS_Store` 文件，其余 dotfile 正常展示。
pub fn list_dir(path: &str) -> Result<Vec<DirEntry>, String> {
    let mut entries = fs::read_dir(path)
        .map_err(|e| format!("读取目录失败: {e}"))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            if is_dir && name == ".git" {
                return None;
            }
            if !is_dir && name == ".DS_Store" {
                return None;
            }
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
/// 内联图片上限(codemoss 同值 20MB):超出拒绝转 dataURL,前端回退 asset:// 直载。
const MAX_INLINE_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// 支持的图片扩展名 → MIME。白名单制,非图片直接拒绝。
fn image_mime_type(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        "apng" => Some("image/apng"),
        _ => None,
    }
}

/// 读取本地图片转 data URL(markdown 预览 asset:// 加载失败的回退通道)。
/// 照抄 codemoss read_local_image_data_url:绝对路径 + 文件校验 + 大小与扩展名白名单。
pub fn read_local_image_data_url(path: &str) -> Result<String, String> {
    let absolute = std::path::Path::new(path);
    if !absolute.is_absolute() {
        return Err("图片路径必须是绝对路径".to_string());
    }
    let meta = fs::metadata(absolute).map_err(|e| format!("读取图片信息失败: {e}"))?;
    if !meta.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    if meta.len() > MAX_INLINE_IMAGE_BYTES {
        return Err(format!(
            "图片过大,不支持内联(上限 {}MB)",
            MAX_INLINE_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let mime = image_mime_type(absolute).ok_or_else(|| "不支持的图片格式".to_string())?;
    let bytes = fs::read(absolute).map_err(|e| format!("读取图片失败: {e}"))?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
}

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



/// 带修改时间的文件条目 —— CLI 磁盘会话扫描(fs_collect_files)的返回单元。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub name: String,
    pub path: String,
    /// 修改时间 ms epoch;取不到为 0。
    pub modified_at: u64,
}

/// 递归收集目录下指定后缀的文件,按修改时间倒序。
/// 目录不存在 = 空表(新工作区还没有任何会话,非错误)。
/// 通用原语:omp/pi 的单层 jsonl 目录与 codex 的 YYYY/MM/DD 递归目录共用。
pub fn collect_files(dir: &str, suffix: &str) -> Result<Vec<FileStamp>, String> {
    let mut out = Vec::new();
    collect_into(std::path::Path::new(dir), suffix, &mut out);
    out.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(out)
}

fn collect_into(dir: &std::path::Path, suffix: &str, out: &mut Vec<FileStamp>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // 不存在/无权限:静默跳过,由调用方决定语义
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            collect_into(&path, suffix, out);
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(suffix) {
            continue;
        }
        let modified_at = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(FileStamp {
            name,
            path: path.to_string_lossy().to_string(),
            modified_at,
        });
    }
}

/// 读取文件头部最多 max_bytes 字节(UTF-8 损失容忍)。
/// 给 codex 插件解析 rollout 首行 session_meta 用:全文太大,首行足够。
pub fn read_head(path: &str, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let mut f = fs::File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
    let mut buf = vec![0u8; max_bytes];
    let n = f.read(&mut buf).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buf[..n]).to_string())
}
 
/// 读取文件尾部最多 max_bytes 字节(UTF-8 损失容忍)。
/// 给 JSONL session 状态解析用,避免把完整对话文件加载到前端。
pub fn read_tail(path: &str, max_bytes: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(path).map_err(|e| format!("打开文件失败: {e}"))?;
    let file_len = f
        .metadata()
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();
    let offset = file_len.saturating_sub(max_bytes as u64);
    f.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("定位文件失败: {e}"))?;
    let mut buf = Vec::with_capacity((file_len - offset) as usize);
    f.read_to_end(&mut buf)
        .map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}
/// 物理删除单个文件(会话列表"删除会话":双端统一删 CLI 磁盘 jsonl)。
/// 文件不存在视为成功 —— 删除是幂等操作,重试/竞态(活会话刚被 CLI 轮替)不应报错。
pub fn remove_file(path: &str) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除文件失败: {e}")),
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "tmd-cli-list-dir-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("创建临时目录失败");
        root
    }

    #[test]
    fn list_dir_保留常规_dotfile_与_dotdir() {
        let root = temp_root("dotfiles");
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::create_dir_all(root.join(".github")).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join(".gitignore"), "target\n").unwrap();
        fs::write(root.join("README.md"), "# hi\n").unwrap();

        let names: Vec<String> = list_dir(root.to_str().unwrap())
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();

        assert_eq!(
            names,
            vec![".claude", ".github", "src", ".gitignore", "README.md"]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_dir_仅跳过_git_目录与_ds_store_文件() {
        // 主场景:同名目录 .git 与同名文件 .DS_Store 被跳过。
        let root = temp_root("skip");
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".DS_Store"), "junk").unwrap();
        fs::write(root.join("main.rs"), "fn main() {}\n").unwrap();

        let names: Vec<String> = list_dir(root.to_str().unwrap())
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["main.rs"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn list_dir_黑名单按类型匹配() {
        // 名为 .git 的文件、名为 .DS_Store 的目录不在黑名单语义内,必须保留。
        let root = temp_root("skip-type");
        fs::write(root.join(".git"), "not-a-dir").unwrap();
        fs::create_dir_all(root.join(".DS_Store")).unwrap();

        let entries = list_dir(root.to_str().unwrap()).unwrap();
        let dirs: Vec<&str> = entries
            .iter()
            .filter(|e| e.is_dir)
            .map(|e| e.name.as_str())
            .collect();
        let files: Vec<&str> = entries
            .iter()
            .filter(|e| !e.is_dir)
            .map(|e| e.name.as_str())
            .collect();

        assert_eq!(dirs, vec![".DS_Store"]);
        assert_eq!(files, vec![".git"]);
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    fn remove_file_删除存在文件且对缺失文件幂等() {
        let root = temp_root("remove");
        let target = root.join("session.jsonl");
        fs::write(&target, "{}\n").unwrap();

        // 存在的文件:删除成功且确实消失
        remove_file(target.to_str().unwrap()).unwrap();
        assert!(!target.exists());
        // 再删一次(竞态/重试语义):NotFound 幂等成功,不得报错
        remove_file(target.to_str().unwrap()).unwrap();
        let _ = fs::remove_dir_all(&root);
    }
}
