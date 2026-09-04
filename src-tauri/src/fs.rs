//! 文件系统服务：喂右侧文件树 + composer 的 @ 补全。
//!
//! 骨架阶段：单层目录列举。递归/监听/忽略规则随 files 插件实装时补。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
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
/// heic/heif/tif/tiff/ico:与前端 IMAGE_EXTENSIONS 全集对齐(浏览器能否解码
/// 由 <img> 自行兜底,与 codemoss 行为一致 —— 加载失败显示错误文案)。
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
        "ico" => Some("image/x-icon"),
        "tif" | "tiff" => Some("image/tiff"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        _ => None,
    }
}

/// 二进制预览扩展名 → 大小上限。预算对齐 codemoss:
/// pdf 32MB(自定,档位在表格 8MB 之上)/ xls・xlsx 8MB(tabular 预算)/ docx 2MB(document 预算)。
fn binary_preview_byte_limit(path: &std::path::Path) -> Option<u64> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdf" => Some(32 * 1024 * 1024),
        "xls" | "xlsx" => Some(8 * 1024 * 1024),
        "docx" => Some(2 * 1024 * 1024),
        _ => None,
    }
}

/// 读取二进制预览文件为 base64(pdf/xls/xlsx/docx 专用;doc 走前端 legacy 占位,不读)。
/// 绝对路径 + 文件校验 + 扩展名白名单 + 分档大小闸,读完即编码返回。
pub fn read_binary_file_base64(path: &str) -> Result<String, String> {
    let absolute = std::path::Path::new(path);
    if !absolute.is_absolute() {
        return Err("文件路径必须是绝对路径".to_string());
    }
    let meta = fs::metadata(absolute).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if !meta.is_file() {
        return Err("目标路径不是文件".to_string());
    }
    let limit =
        binary_preview_byte_limit(absolute).ok_or_else(|| "不支持的二进制预览格式".to_string())?;
    if meta.len() > limit {
        return Err(format!("文件超过 {}MB,不支持预览", limit / 1024 / 1024));
    }
    let bytes = fs::read(absolute).map_err(|e| format!("读取文件失败: {e}"))?;
    Ok(BASE64.encode(bytes))
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
        return Err(format!(
            "文件超过 {}KB，暂不支持预览",
            MAX_PREVIEW_BYTES / 1024
        ));
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
        .map(|(_, e)| {
            if e.len() <= 5 && !e.is_empty() {
                e
            } else {
                "bin"
            }
        })
        .unwrap_or("bin");
    /* 毫秒时间戳 + 进程内单调计数:同一毫秒内连续上传也不互相覆盖 */
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let path = base.join(format!("upload-{stamp}-{seq:x}.{ext}"));
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
    out.sort_by_key(|f| std::cmp::Reverse(f.modified_at));
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
/// 删除操作允许的 canonical 根前缀 —— 各 CLI 会话数据目录 + 本应用临时区。
/// 与 docs/architecture/02-code-architecture.md §5.1 的会话存储表对应;
/// 新增 CLI 插件时同步维护此表。绝对禁止:文件系统根、home 本身及白名单外的任意路径。
fn allowed_remove_roots() -> Vec<std::path::PathBuf> {
    /* 根也须 canonicalize:macOS 的 temp_dir 在 /var(→/private/var 符号链接)下,
     * 与入参路径的 canonical 形态比较前必须同基准。根可能尚不存在(未创建),
     * canonicalize 失败时退回原始形态 —— 此时其下路径也不存在,删除走 NotFound 幂等。 */
    fn canon_or_self(p: std::path::PathBuf) -> std::path::PathBuf {
        p.canonicalize().unwrap_or(p)
    }
    let home = crate::session::home_dir();
    let mut roots: Vec<std::path::PathBuf> = [
        ".omp",
        ".pi",
        ".claude",
        ".codex",
        ".kimi",
        // kimi-code 0.40 起数据 home 迁到 ~/.kimi-code(.migrated-to-kimi-code 标记),
        // 新会话全落这里;老 .kimi 仅存未迁移机器的会话,两个都得放行。
        ".kimi-code",
        ".grok",
        ".qoder",
        ".qoder-cn",
        ".tmd-cli",
    ]
    .iter()
    .map(|d| home.join(d))
    .map(canon_or_self)
    .collect();
    roots.push(canon_or_self(std::env::temp_dir().join("tmd-cli")));
    roots
}
/// 安全面:renderer 不可信,删除原语只对白名单根前缀内的 canonical 路径开放。
pub fn remove_path(path: &str) -> Result<(), String> {
    let p = std::path::Path::new(path);
    let canonical = match p.canonicalize() {
        Ok(c) => c,
        /* 路径不存在 = 删除已达成:幂等语义在此兑现,不进白名单检查 */
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("路径不可解析: {e}")),
    };
    let ok = allowed_remove_roots()
        .iter()
        .any(|root| canonical.starts_with(root));
    if !ok {
        return Err(format!("拒绝删除白名单外的路径: {path}"));
    }
    let result = if canonical.is_dir() {
        fs::remove_dir_all(&canonical)
    } else {
        fs::remove_file(&canonical)
    };
    match result {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除失败: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("tmd-cli-list-dir-{tag}-{}", std::process::id()));
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

    /// remove_path 测试专用根:temp_dir()/tmd-cli 本身就在白名单内。
    fn remove_test_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir()
            .join("tmd-cli")
            .join(format!("remove-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("创建临时目录失败");
        root
    }

    #[test]
    fn read_binary_file_base64_白名单与大小闸() {
        let root = temp_root("bin-preview");
        // 白名单外扩展:拒绝
        let txt = root.join("note.txt");
        fs::write(&txt, "hi").unwrap();
        assert!(read_binary_file_base64(txt.to_str().unwrap()).is_err());

        // 白名单内(pdf):返回 base64,可无损往返
        let pdf = root.join("doc.pdf");
        let payload: &[u8] = &[0x25, 0x50, 0x44, 0x46, 0x2d, 0x01, 0x00];
        fs::write(&pdf, payload).unwrap();
        let encoded = read_binary_file_base64(pdf.to_str().unwrap()).unwrap();
        assert_eq!(BASE64.decode(encoded).unwrap(), payload.to_vec());

        // 相对路径:拒绝
        assert!(read_binary_file_base64("relative/doc.pdf").is_err());
        // 不存在:报错而非 panic
        assert!(read_binary_file_base64(root.join("none.pdf").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn binary_preview_byte_limit_分档() {
        fn limit(name: &str) -> Option<u64> {
            binary_preview_byte_limit(std::path::Path::new(name))
        }
        assert_eq!(limit("a.pdf"), Some(32 * 1024 * 1024));
        assert_eq!(limit("b.XLSX"), Some(8 * 1024 * 1024));
        assert_eq!(limit("c.xls"), Some(8 * 1024 * 1024));
        assert_eq!(limit("d.docx"), Some(2 * 1024 * 1024));
        assert_eq!(limit("e.doc"), None); // legacy doc 不读盘
        assert_eq!(limit("f.txt"), None);
    }

    #[test]
    fn image_mime_type_覆盖前端图片全集() {
        fn mime(name: &str) -> Option<&'static str> {
            image_mime_type(std::path::Path::new(name))
        }
        assert_eq!(mime("logo.ico"), Some("image/x-icon"));
        assert_eq!(mime("scan.TIFF"), Some("image/tiff"));
        assert_eq!(mime("shot.heic"), Some("image/heic"));
        assert_eq!(mime("shot.heif"), Some("image/heif"));
        assert_eq!(mime("plain.txt"), None);
    }

    #[test]
    fn remove_path_删文件删目录且对缺失路径幂等() {
        let root = remove_test_root("ok");
        let file = root.join("session.jsonl");
        fs::write(&file, "{}\n").unwrap();

        // 存在的文件:删除成功且确实消失
        remove_path(file.to_str().unwrap()).unwrap();
        assert!(!file.exists());
        // 再删一次(竞态/重试语义):NotFound 幂等成功,不得报错
        remove_path(file.to_str().unwrap()).unwrap();

        // 目录(含嵌套内容):整树删除 —— kimi 会话目录形态
        let dir = root.join("910a");
        fs::create_dir_all(dir.join("uuid")).unwrap();
        fs::write(dir.join("uuid").join("wire.jsonl"), "{}\n").unwrap();
        remove_path(dir.to_str().unwrap()).unwrap();
        assert!(!dir.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_path_拒绝白名单外的路径() {
        // 白名单外(临时目录散列根)的路径必须被拒,防 renderer 任意删除
        let outside = std::env::temp_dir().join(format!("tmd-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("x.txt"), "keep").unwrap();
        let err = remove_path(outside.to_str().unwrap()).unwrap_err();
        assert!(err.contains("白名单"), "应报白名单拒绝: {err}");
        assert!(outside.join("x.txt").exists(), "白名单外文件不得被动");
        let _ = fs::remove_dir_all(&outside);

        // 存在的文件 + 白名单内:正常删除(正例对照)
        let root = remove_test_root("allow");
        fs::write(root.join("y.txt"), "x").unwrap();
        remove_path(root.join("y.txt").to_str().unwrap()).unwrap();
        assert!(!root.join("y.txt").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
