//! 文件预览读取 —— 文本(大小闸 + 二进制拒绝)/ 图片 dataURL / 二进制 base64。
//! 自 fs.rs 拆出(文件规模铁则);白名单与大小预算对齐 codemoss。

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use std::fs;

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
}
