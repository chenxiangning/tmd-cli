//! skill 包原语 ── skill-hub 插件的下载/解压/补链三原子命令。
//!
//! 语义边界(提案 2026-09-28-skill-hub-plugin §4.5/§4.6):
//! - `net_download`:URL → dest_dir 下临时文件(文件名 = URL 的 MD5 + .tmp),
//!   60s 超时、跟随重定向;zip 二进制不走 quota_fetch(body 通道是 JSON 文本)。
//! - `skill_extract`:zip 解压。安全闸:条目名含 `..`/绝对路径/反斜杠 = 拒绝
//!   (zip-slip);symlink entry = 拒绝(公约位兼容性靠用户显式勾选 symlink,
//!   不由包内携带);解压总大小 >10MB = 拒绝。strip_top = 剥离单顶层目录
//!   (GitHub 式包形状;ClawHub 包是平铺文件,无单顶层时不剥,原样落位)。
//! - `skill_symlink`:建目录符号链接(claude 补链选项);Windows 无特权时
//!   原样报错,前端降级为提示,不阻断安装。
//!
//! 测试纪律:zip fixture 用 ZipWriter 现场造(Stored 方法,不依赖压缩后端)。

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

/// 解压总大小上限(解压声明值与实际写字节双闸)。
const MAX_TOTAL_BYTES: u64 = 10 * 1024 * 1024;
/// 下载超时(网络慢盘兜底;skill 包秒级小件)。
const DOWNLOAD_TIMEOUT_SECS: u64 = 60;
/// macOS 归档垃圾段(AppleDouble/资源分叉),静默跳过。
const MACOS_JUNK: &str = "__MACOSX";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetDownloadResult {
    pub path: String,
    pub bytes: u64,
}

/// 下载 URL 到 dest_dir 下临时文件。async 命令(quota_fetch 同款纪律:
/// 网络等待在 runtime,分块落盘为本地快写)。
#[tauri::command]
pub async fn net_download(url: String, dest_dir: String) -> Result<NetDownloadResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client build: {e}"))?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败 HTTP {}", resp.status()));
    }
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let file_path = dest.join(format!("{}.tmp", crate::hash::md5_hex(url)));
    let mut file = fs::File::create(&file_path).map_err(|e| format!("创建临时文件失败: {e}"))?;
    let mut bytes: u64 = 0;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("下载中断: {e}"))? {
        bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .map_err(|e| format!("写盘失败: {e}"))?;
    }
    Ok(NetDownloadResult {
        path: file_path.to_string_lossy().into_owned(),
        bytes,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExtractResult {
    /// 解出的文件数(目录不计)。
    pub entries: u32,
}

/// zip 条目名安全闸:拒绝绝对路径 / `..` 分量 / 反斜杠(zip 规范用 `/`,
/// 反斜杠名在 Windows 解出即越权分隔符)。
fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('\\') {
        return Err(format!("非法条目名: {name}"));
    }
    let path = Path::new(name);
    if path.is_absolute() {
        return Err(format!("条目名是绝对路径: {name}"));
    }
    for comp in path.components() {
        match comp {
            Component::ParentDir => return Err(format!("条目名含 ..,拒绝(zip-slip): {name}")),
            Component::Prefix(_) => return Err(format!("条目名含盘符前缀: {name}")),
            _ => {}
        }
    }
    Ok(())
}

/// unix mode 的文件类型位是否 symlink(包内携带链接 = 拒)。
/// ZipWriter 写不出 symlink 类型位(写侧钳到常规文件),该纯函数单测直测。
fn unix_mode_is_symlink(mode: Option<u32>) -> bool {
    mode.is_some_and(|m| m & 0o170000 == 0o120000)
}

fn entry_is_symlink(entry: &zip::read::ZipFile<'_>) -> bool {
    unix_mode_is_symlink(entry.unix_mode())
}

/// 解压编排:两遍扫描(先全量校验安全闸与总量,再落盘)——坏包在写任何
/// 字节前整体拒绝,不留半成品。
fn extract_zip(
    archive: &str,
    dest_dir: &str,
    strip_top: bool,
) -> Result<SkillExtractResult, String> {
    let file = fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败: {e}"))?;

    // 第一遍:校验 + 顶层目录判定。
    let mut names: Vec<String> = Vec::new();
    let mut total: u64 = 0;
    let mut tops: BTreeSet<String> = BTreeSet::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| format!("读取条目失败: {e}"))?;
        let name = entry.name().to_string();
        if name.is_empty() {
            continue;
        }
        let first = name.split('/').next().unwrap_or_default();
        if first == MACOS_JUNK || name.split('/').any(|seg| seg.starts_with("._")) {
            continue; // macOS 打包垃圾,静默跳过
        }
        validate_entry_name(&name)?;
        if entry_is_symlink(&entry) {
            return Err(format!("包内含符号链接,拒绝: {name}"));
        }
        if !entry.is_dir() {
            total += entry.size();
            if total > MAX_TOTAL_BYTES {
                return Err("解压总大小超过 10MB 上限,拒绝".into());
            }
        }
        tops.insert(first.to_string());
        names.push(name);
    }
    if names.is_empty() {
        return Err("压缩包为空".into());
    }
    // strip_top:全部条目共享单顶层目录(且该目录确实是目录段)才剥;
    // ClawHub 平铺包(tops 是文件名集合)不剥,原样落位。
    let strip = if strip_top && tops.len() == 1 {
        let top = tops.iter().next().cloned().unwrap_or_default();
        let prefix = format!("{top}/");
        names
            .iter()
            .any(|n| n.starts_with(&prefix))
            .then_some(prefix)
    } else {
        None
    };

    // 第二遍:落盘(实际写字节再验一次总量,防声明值撒谎)。
    let dest = Path::new(dest_dir);
    fs::create_dir_all(dest).map_err(|e| format!("创建目标目录失败: {e}"))?;
    let mut written: u64 = 0;
    let mut entries: u32 = 0;
    for name in &names {
        let rel = match &strip {
            Some(prefix) => match name.strip_prefix(prefix.as_str()) {
                Some(rest) => rest,
                None => continue, // 顶层目录条目本身,剥离后即目标根
            },
            None => name.as_str(),
        };
        let mut entry = zip
            .by_name(name)
            .map_err(|e| format!("读取条目失败: {e}"))?;
        if entry.is_dir() {
            fs::create_dir_all(dest.join(rel)).map_err(|e| format!("创建目录失败: {e}"))?;
            continue;
        }
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        let mut out = fs::File::create(&target).map_err(|e| format!("写文件失败: {e}"))?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = entry
                .read(&mut buf)
                .map_err(|e| format!("解压读取失败: {e}"))?;
            if n == 0 {
                break;
            }
            written += n as u64;
            if written > MAX_TOTAL_BYTES {
                return Err("解压总大小超过 10MB 上限,拒绝".into());
            }
            out.write_all(&buf[..n])
                .map_err(|e| format!("写文件失败: {e}"))?;
        }
        entries += 1;
    }
    Ok(SkillExtractResult { entries })
}

/// zip 解压(重阻塞:spawn_blocking 不占 runtime 线程)。
#[tauri::command]
pub async fn skill_extract(
    archive: String,
    dest_dir: String,
    strip_top: bool,
) -> Result<SkillExtractResult, String> {
    tokio::task::spawn_blocking(move || extract_zip(&archive, &dest_dir, strip_top))
        .await
        .map_err(|e| format!("解压任务失败: {e}"))?
}

/// 建符号链接的同步核心(单测直测;Windows 需特权,失败原样报错)。
fn create_skill_symlink(target: &str, link: &str) -> Result<(), String> {
    let link_path = Path::new(link);
    if link_path.symlink_metadata().is_ok() {
        return Err("链接路径已存在".into());
    }
    if let Some(parent) = link_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建链接父目录失败: {e}"))?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link_path).map_err(|e| format!("创建符号链接失败: {e}"))
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link_path)
            .map_err(|e| format!("创建符号链接失败(Windows 需开发者模式/特权): {e}"))
    }
}

/// 建目录符号链接(公约位安装的 claude 补链;链接已存在 = 报错由调用方裁决)。
#[tauri::command]
pub async fn skill_symlink(target: String, link: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || create_skill_symlink(&target, &link))
        .await
        .map_err(|e| format!("补链任务失败: {e}"))?
}

#[cfg(test)]
#[path = "skill_pkg_tests.rs"]
mod tests;
