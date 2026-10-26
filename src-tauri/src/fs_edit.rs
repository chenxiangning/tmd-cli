//! 文件编辑/管理写操作 —— 右键菜单(新建/重命名/废纸篓/访达)与编辑器保存的后端原语。
//!
//! 与 fs.rs(只读列举/预览)分离:本模块全部是写操作,单独成文件也避免 fs.rs
//! 突破 500 行铁则。安全基线照抄 codemoss:绝对路径 + 禁止触碰 `.git` 段 +
//! 写入大小上限;删除走系统废纸篓(trash crate)而非物理删除,可挽回。

use std::fs;
use std::path::Path;

/// 写入上限 = 预览读上限(fs_preview MAX_PREVIEW_BYTES 100MB)× 2:读闸量的是
/// 磁盘字节,写闸量的是编辑器 CRLF 还原本(每行 +1 字节,最坏翻倍);两闸等值
/// 会让大 CRLF 文件「读得开、存不进」,留一倍膨胀头寸。
const MAX_WRITE_BYTES: usize = 200 * 1024 * 1024;

/// 路径校验:必须是绝对路径,且任意段不得为 `.git`(树不展示、也不允许改写)。
pub(crate) fn validate_target(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("路径必须是绝对路径".to_string());
    }
    for seg in p.components() {
        if seg.as_os_str().to_string_lossy() == ".git" {
            return Err("禁止操作 .git 目录内的路径".to_string());
        }
    }
    Ok(())
}

/// 重命名/新建的文件名校验:禁止空名、路径分隔符、`.`/`..`、NUL。
/// 只允许裸文件名 —— 拼接由后端完成,前端传父目录 + 单段名字。
fn validate_basename(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("名称不能包含路径分隔符".to_string());
    }
    if name.contains('\0') {
        return Err("名称包含非法字符".to_string());
    }
    Ok(())
}

/// mtime(毫秒):外部变更冲突检测基线;文件不存在/不可读回 None。
pub fn mtime_ms(p: &Path) -> Option<u64> {
    p.metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

/// 覆写文本文件(编辑器保存通道;新建入口禁止走这里,见 create_file)。
/// expect_mtime = 乐观锁:与磁盘当前 mtime 不符(外部修改/删除)即拒写,
/// 堵「编辑器开着旧版一 ⌘S 静默覆盖 AI/终端并发写」;None = 无守卫直写。
/// 成功返回写后 mtime,供调用方滚动基线。
pub fn write_file(path: &str, content: &str, expect_mtime: Option<u64>) -> Result<u64, String> {
    validate_target(path)?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "内容超过 {}MB,拒绝写入",
            MAX_WRITE_BYTES / 1024 / 1024
        ));
    }
    let p = Path::new(path);
    if p.is_dir() {
        return Err("目标路径是目录,不能写入文件".to_string());
    }
    if let Some(expect) = expect_mtime {
        match mtime_ms(p) {
            Some(actual) if actual == expect => {}
            _ => {
                return Err("E_FS_MTIME 磁盘文件已被外部修改或删除,保存已阻止".to_string());
            }
        }
    }
    crate::session::write_atomic(p, content.as_bytes()).map_err(|e| format!("写入文件失败: {e}"))?;
    mtime_ms(p).ok_or_else(|| "写入成功但读取时间戳失败".to_string())
}

/// 新建空文件。已存在(无论文件还是目录)都报错 —— 与 create_dir 同语义:
/// 新建入口绝不能静默覆写已有内容(write_file 是保存通道,允许覆写)。
pub fn create_file(path: &str) -> Result<(), String> {
    validate_target(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::write(p, "").map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "父目录不存在".to_string()
        } else {
            format!("创建文件失败: {e}")
        }
    })
}

/// 新建文件夹。已存在(无论文件还是目录)都报错 —— 新建语义下静默幂等会误导用户。
pub fn create_dir(path: &str) -> Result<(), String> {
    validate_target(path)?;
    let p = Path::new(path);
    if p.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::create_dir(p).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "父目录不存在".to_string()
        } else {
            format!("创建文件夹失败: {e}")
        }
    })
}

/// 复制上限:资源入库通道(壁纸受管副本等),远高于文本保存 16MB;
/// 拦截误传的影片/镜像级巨物。
const MAX_COPY_BYTES: u64 = 256 * 1024 * 1024;

/// 复制文件(资源入库通道,如壁纸受管副本)。新建语义:目标已存在即报错,
/// 绝不静默覆写;父目录须已存在(建目录走 create_dir,不在复制里隐式建)。
pub fn copy_file(src: &str, dst: &str) -> Result<(), String> {
    validate_target(src)?;
    validate_target(dst)?;
    let from = Path::new(src);
    if !from.is_file() {
        return Err("源路径不是文件".to_string());
    }
    let to = Path::new(dst);
    if to.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    let meta = fs::metadata(from).map_err(|e| format!("读取文件信息失败: {e}"))?;
    if meta.len() > MAX_COPY_BYTES {
        return Err(format!(
            "文件超过 {}MB,拒绝复制",
            MAX_COPY_BYTES / 1024 / 1024
        ));
    }
    fs::copy(from, to).map_err(|e| format!("复制文件失败: {e}"))?;
    Ok(())
}

/// 目录树复制总量上限:技能目录(SKILL.md + scripts/references)量级远低于此;
/// 拦截误传的 node_modules/数据集级目录。
const MAX_TREE_BYTES: u64 = 32 * 1024 * 1024;

/// 递归复制目录树(composer 通用技能落位公约位用)。新建语义:目标已存在即
/// 报错,绝不静默覆写;父目录须已存在;总量超 MAX_TREE_BYTES 拒绝;symlink
/// 按链接本身复制(技能目录无链接语义依赖,克隆链接目标反而会双写)。
pub fn copy_tree(src: &str, dst: &str) -> Result<(), String> {
    validate_target(src)?;
    validate_target(dst)?;
    let from = Path::new(src);
    if !from.is_dir() {
        return Err("源路径不是目录".to_string());
    }
    let to = Path::new(dst);
    if to.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    let mut total: u64 = 0;
    copy_dir(from, to, &mut total)?;
    Ok(())
}

fn copy_dir(from: &Path, to: &Path, total: &mut u64) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("创建目录失败: {e}"))?;
    for entry in fs::read_dir(from).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let path = entry.path();
        let name = entry.file_name();
        if name == ".DS_Store" {
            continue; // macOS 噪声不入副本
        }
        if path.is_dir() {
            copy_dir(&path, &to.join(&name), total)?;
        } else {
            let meta = entry
                .metadata()
                .map_err(|e| format!("读取文件信息失败: {e}"))?;
            *total = total.saturating_add(meta.len());
            if *total > MAX_TREE_BYTES {
                return Err(format!(
                    "目录总量超过 {}MB,拒绝复制",
                    MAX_TREE_BYTES / 1024 / 1024
                ));
            }
            fs::copy(&path, to.join(&name)).map_err(|e| format!("复制文件失败: {e}"))?;
        }
    }
    Ok(())
}

/// 重命名(同目录内改名)。返回新绝对路径;目标已存在时报错(不静默覆盖)。
pub fn rename_entry(path: &str, new_name: &str) -> Result<String, String> {
    validate_target(path)?;
    validate_basename(new_name)?;
    let from = Path::new(path);
    if !from.exists() {
        return Err("原路径不存在".to_string());
    }
    let parent = from.parent().ok_or("路径缺少父目录")?;
    let to = parent.join(new_name);
    if to.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    fs::rename(from, &to).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(to.to_string_lossy().to_string())
}

/// 移入系统废纸篓。路径不存在视为已达成(幂等,与 fs::remove_path 语义一致)。
pub fn trash_entry(path: &str) -> Result<(), String> {
    validate_target(path)?;
    let p = Path::new(path);
    if !p.exists() {
        return Ok(());
    }
    trash::delete(p).map_err(|e| format!("移到废纸篓失败: {e}"))
}

/// 在系统文件管理器中显示(macOS Finder 的「Reveal」)。
/// macOS `open -R` 原生选中;Windows explorer /select;Linux 退回打开父目录。
pub fn reveal_in_file_manager(path: &str) -> Result<(), String> {
    validate_target(path)?;
    let p = Path::new(path);
    if !p.exists() {
        return Err("路径不存在".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| format!("打开访达失败: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let select = format!("/select,{}", p.display());
        Command::new("explorer")
            .arg(select)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {e}"))?;
        Ok(())
    }
}

/* ── Tauri command 包装(签名风格与 fs.rs 一致:snake_case 参数由前端传 camelCase)。
统一 async + spawn_blocking(commands_fs 同款纪律):写盘/废纸篓/拉起
文件管理器都是阻塞 IO,同步执行跑在主线程会掉帧。── */

#[tauri::command]
pub(crate) async fn fs_write_file(
    path: String,
    content: String,
    expect_mtime: Option<u64>,
) -> Result<u64, String> {
    crate::commands_fs::spawn_fs(move || write_file(&path, &content, expect_mtime)).await
}

/// 磁盘 mtime(毫秒):编辑器打开时取基线,保存前比对(乐观锁的另一端)。
#[tauri::command]
pub(crate) async fn fs_mtime(path: String) -> Result<Option<u64>, String> {
    crate::commands_fs::spawn_fs(move || Ok(mtime_ms(Path::new(&path)))).await
}

#[tauri::command]
pub(crate) async fn fs_create_file(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || create_file(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_create_dir(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || create_dir(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_rename_entry(path: String, new_name: String) -> Result<String, String> {
    crate::commands_fs::spawn_fs(move || rename_entry(&path, &new_name)).await
}

#[tauri::command]
pub(crate) async fn fs_trash_entry(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || trash_entry(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_reveal_in_file_manager(path: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || reveal_in_file_manager(&path)).await
}

#[tauri::command]
pub(crate) async fn fs_copy_file(src: String, dst: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || copy_file(&src, &dst)).await
}

#[tauri::command]
pub(crate) async fn fs_copy_tree(src: String, dst: String) -> Result<(), String> {
    crate::commands_fs::spawn_fs(move || copy_tree(&src, &dst)).await
}

#[cfg(test)]
#[path = "fs_edit_tests.rs"]
mod tests;
