//! 文件编辑/管理写操作 —— 右键菜单(新建/重命名/废纸篓/访达)与编辑器保存的后端原语。
//!
//! 与 fs.rs(只读列举/预览)分离:本模块全部是写操作,单独成文件也避免 fs.rs
//! 突破 500 行铁则。安全基线照抄 codemoss:绝对路径 + 禁止触碰 `.git` 段 +
//! 写入大小上限;删除走系统废纸篓(trash crate)而非物理删除,可挽回。

use std::fs;
use std::path::Path;

/// 写入上限:与前端编辑场景对齐(预览读上限 512KB,保存放宽到 16MB 防误传巨量数据)。
const MAX_WRITE_BYTES: usize = 16 * 1024 * 1024;

/// 路径校验:必须是绝对路径,且任意段不得为 `.git`(树不展示、也不允许改写)。
fn validate_target(path: &str) -> Result<(), String> {
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

/// 覆写文本文件(编辑器保存通道;新建入口禁止走这里,见 create_file)。
pub fn write_file(path: &str, content: &str) -> Result<(), String> {
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
    fs::write(p, content).map_err(|e| format!("写入文件失败: {e}"))
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

/* ── Tauri command 包装(签名风格与 fs.rs 一致:snake_case 参数由前端传 camelCase)── */

#[tauri::command]
pub fn fs_write_file(path: String, content: String) -> Result<(), String> {
    write_file(&path, &content)
}

#[tauri::command]
pub fn fs_create_file(path: String) -> Result<(), String> {
    create_file(&path)
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    create_dir(&path)
}

#[tauri::command]
pub fn fs_rename_entry(path: String, new_name: String) -> Result<String, String> {
    rename_entry(&path, &new_name)
}

#[tauri::command]
pub fn fs_trash_entry(path: String) -> Result<(), String> {
    trash_entry(&path)
}

#[tauri::command]
pub fn fs_reveal_in_file_manager(path: String) -> Result<(), String> {
    reveal_in_file_manager(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("tmd-cli-fs-edit-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("创建临时目录失败");
        root
    }

    #[test]
    fn write_file_覆写与新建空文件() {
        let root = temp_root("write");
        let file = root.join("a.txt");

        // 新建(父目录存在,内容为空)
        write_file(file.to_str().unwrap(), "").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"");

        // 覆写
        write_file(file.to_str().unwrap(), "hello\n").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"hello\n");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_file_拒绝相对路径_git_段_与目录目标() {
        let root = temp_root("guard");
        let git_dir = root.join(".git");
        fs::create_dir_all(&git_dir).unwrap();

        assert!(write_file("relative/path.txt", "x").is_err());
        assert!(write_file(git_dir.join("x").to_str().unwrap(), "x").is_err());
        assert!(write_file(root.to_str().unwrap(), "x").is_err());
        assert!(
            fs::read(git_dir.join("x")).is_err(),
            ".git 内文件不得被创建"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_file_新建成功且拒绝覆写已有内容() {
        let root = temp_root("cfile");
        let file = root.join("new.txt");

        create_file(file.to_str().unwrap()).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"");

        // 已存在文件 → 报错且内容原封不动(绝不覆写)
        fs::write(&file, "keep").unwrap();
        let err = create_file(file.to_str().unwrap()).unwrap_err();
        assert!(err.contains("已存在"), "应报已存在: {err}");
        assert_eq!(fs::read(&file).unwrap(), b"keep");
        // 同名目录存在 → 也报错
        let dir = root.join("conflict");
        fs::create_dir_all(&dir).unwrap();
        assert!(create_file(dir.to_str().unwrap()).is_err());
        // 父目录缺失 → 报错而不是递归创建
        assert!(create_file(root.join("no-such-parent/child.txt").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn create_dir_新建成功且已存在报错() {
        let root = temp_root("mkdir");
        let dir = root.join("new-dir");

        create_dir(dir.to_str().unwrap()).unwrap();
        assert!(dir.is_dir());
        // 已存在目录 → 报错
        let err = create_dir(dir.to_str().unwrap()).unwrap_err();
        assert!(err.contains("已存在"), "应报已存在: {err}");
        // 同名文件存在 → 也报错
        let file = root.join("conflict");
        fs::write(&file, "x").unwrap();
        assert!(create_dir(file.to_str().unwrap()).is_err());
        // 父目录缺失 → 报错而不是递归创建
        assert!(create_dir(root.join("no-such-parent/child").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rename_entry_改名返回新路径且拒绝非法名与撞名() {
        let root = temp_root("rename");
        let file = root.join("old.txt");
        fs::write(&file, "data").unwrap();

        let new_path = rename_entry(file.to_str().unwrap(), "new.txt").unwrap();
        assert_eq!(new_path, root.join("new.txt").to_string_lossy().to_string());
        assert!(!file.exists());
        assert_eq!(fs::read(root.join("new.txt")).unwrap(), b"data");

        // 目标名撞已有文件
        fs::write(root.join("b.txt"), "b").unwrap();
        let err = rename_entry(root.join("new.txt").to_str().unwrap(), "b.txt").unwrap_err();
        assert!(err.contains("已存在"), "撞名应报已存在: {err}");

        // 非法文件名
        assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "a/b").is_err());
        assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "..").is_err());
        assert!(rename_entry(root.join("new.txt").to_str().unwrap(), "").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn trash_entry_对缺失路径幂等且拒绝_git_段() {
        let root = temp_root("trash");
        // 不存在 → 幂等成功
        trash_entry(root.join("nope.txt").to_str().unwrap()).unwrap();
        // .git 段 → 拒绝(即使不存在)
        assert!(trash_entry(root.join(".git/x").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reveal_拒绝不存在的路径() {
        let root = temp_root("reveal");
        assert!(reveal_in_file_manager(root.join("nope.txt").to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
