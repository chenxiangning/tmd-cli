//! 临时上传写面(fs_write_temp 服务端实现;文件规模铁则自 fs.rs 拆出,
//! 先例 fs_preview.rs / fs_remove.rs)。
//!
//! 手机选图/拍照与桌面截图注入的落盘通道:name 只用于抽白名单扩展名,
//! 文件名全由时间戳+序号生成(无路径拼接面);服务端字节闸 + 按年龄老化
//! 清理防 temp/tmd-cli 无界增长(2026-10-03 二轮评审)。

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

/// 临时上传字节上限:客户端预算 850KB,此处是服务端第二道闸(配对设备=
/// SSH 信任模型,防异常/恶意直灌大帧占满磁盘)。
pub const TEMP_WRITE_MAX_BYTES: usize = 8 * 1024 * 1024;
/// upload-* 老化保留期:手机选图/拍照把低频通道变常态写面,无回收则
/// temp/tmd-cli 无界增长;写入时顺带清理超期文件(与草稿 TTL 同为 7 天)。
const TEMP_RETENTION: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 3600);

/// 把字节写入临时目录(用户上传的图片/截图)。返回绝对路径。
pub fn write_temp_file(name: &str, bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > TEMP_WRITE_MAX_BYTES {
        return Err(format!(
            "临时上传超过 {}MB 上限",
            TEMP_WRITE_MAX_BYTES / 1024 / 1024
        ));
    }
    let base = std::env::temp_dir().join("tmd-cli");
    fs::create_dir_all(&base).map_err(|e| format!("创建临时目录失败: {e}"))?;
    purge_stale_uploads(&base);
    // 从 name 抽扩展名(空则 bin)
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| {
            /* 白名单字母数字:用户可控 name 的 ext 不得带分隔符等拼进文件名 */
            if e.len() <= 5 && !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()) {
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

/// 清理超期 upload-*:只认自己命名空间(形制判定见 is_upload_artifact),
/// 失败静默(清理是顺带收益,不阻断写入)。
fn purge_stale_uploads(base: &std::path::Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        if !is_upload_artifact(&entry.file_name().to_string_lossy()) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified
            .elapsed()
            .map(|e| e > TEMP_RETENTION)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// upload-{纯数字}-{十六进制}.{字母数字扩展名} 形制(write_temp_file 的
/// 命名空间):purge 只动形内文件,防误删用户/其它进程恰在同目录的文件。
fn is_upload_artifact(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let Some((pfx, seq)) = stem.rsplit_once('-') else {
        return false;
    };
    /* "upload-" 恒 7 字节。 */
    pfx.len() > 7
        && &pfx[..7] == "upload-"
        && pfx[7..].bytes().all(|b| b.is_ascii_digit())
        && !seq.is_empty()
        && seq.bytes().all(|b| b.is_ascii_hexdigit())
        && !ext.is_empty()
        && ext.bytes().all(|b| b.is_ascii_alphanumeric())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_temp_file_超上限拒写() {
        // 服务端第二道闸:配对设备异常直灌大帧(客户端预算之外)在此拒绝。
        let big = vec![0u8; TEMP_WRITE_MAX_BYTES + 1];
        assert!(write_temp_file("shot.jpg", &big).is_err());
        assert!(write_temp_file("shot.jpg", b"ok").is_ok());
    }

    #[test]
    fn is_upload_artifact_只认自身命名空间() {
        // 形内:upload-{纯数字}-{十六进制}.{字母数字}
        for ok in [
            "upload-1700000000000-1.jpg",
            "upload-0-ff.bin",
            "upload-123-abc.JPG",
        ] {
            assert!(is_upload_artifact(ok), "{ok} 应被判形内");
        }
        // 形外:前缀不符 / 序数非十六进制 / 时间戳非数字 / 扩展名带分隔符或空
        for bad in [
            "upload-1700000000000-1.tar.gz", /* rsplit 后 ext=gz,stem 尾段 seq="1.tar" 含非十六进制 → 否 */
            "uploads-1-1.jpg",
            "upload--1.jpg",
            "upload-abc-1.jpg",
            "upload-1-0x.jpg",
            "upload-1-1.",
            "shell.log",
            "别的文件.txt",
            "upload-1-1",
        ] {
            assert!(!is_upload_artifact(bad), "{bad} 应被判形外");
        }
    }
}
