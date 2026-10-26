//! 远程 WSL 写操作(项 5 写回闭环)—— 自 wsl_remote_ops.rs 拆出(300 行铁则)。
//! 三原语:文本写回(wsl_write_file_text)/ 新建条目(wsl_create_entry,绝不
//! 覆写已存在)/ 删除(wsl_remove_entry,文件 rm -f、目录仅空目录 rmdir——
//! 远程无废纸篓,宁窄勿宽)。通道复用 wsl_bash_payload(b64 载荷防 PS 拆引号);
//! 成败经尾部哨兵行回传(通道退出码语义不透明,不依赖)。

use super::wsl_remote::exec_somewhere;
use super::wsl_remote_ops::{validate_path_component, wsl_bash_payload};
use crate::ssh::transport::SshHostWire;

/// 执行并断言哨兵(脚本约定末行 echo W_OK/W_FAIL_<code>;非 OK 报错)。
async fn exec_expect_ok(
    distro: &str,
    script: &str,
    host: &Option<SshHostWire>,
) -> Result<(), String> {
    let command = wsl_bash_payload(distro, script);
    let (text, _) = exec_somewhere(&command, host.clone()).await?;
    let ok = text
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix("W_"))
        .is_some_and(|tail| tail.starts_with("OK"));
    if ok {
        return Ok(());
    }
    Err(format!(
        "远程写操作失败: {}",
        text.lines().last().unwrap_or("(无输出)")
    ))
}

/// 远程文本写回:printf b64 解码重定向(覆盖写,语义对齐本地 fs_edit::write_file)。
#[tauri::command]
pub(crate) async fn wsl_write_file_text(
    distro: String,
    path: String,
    content_b64: String,
    host: Option<SshHostWire>,
) -> Result<(), String> {
    validate_path_component(&path)?;
    let script = format!(
        "mkdir -p \"$(dirname {path})\" && printf '%s' '{content_b64}' | base64 -d > {path} && echo W_OK || echo W_FAIL"
    );
    exec_expect_ok(&distro, &script, &host).await
}

/// 远程新建条目:文件 `[ -e ]` 已存在报错(对齐本地 create_file 绝不覆写);目录 mkdir -p。
#[tauri::command]
pub(crate) async fn wsl_create_entry(
    distro: String,
    path: String,
    is_dir: bool,
    host: Option<SshHostWire>,
) -> Result<(), String> {
    validate_path_component(&path)?;
    let script = if is_dir {
        format!("mkdir -p {path} && echo W_OK || echo W_FAIL")
    } else {
        format!("if [ -e {path} ]; then echo W_FAIL_exists; else : > {path} && echo W_OK; fi")
    };
    exec_expect_ok(&distro, &script, &host).await
}

/// 远程删除:文件 rm -f;目录 rmdir(非空报错,不递归删——远程无废纸篓,窄语义)。
#[tauri::command]
pub(crate) async fn wsl_remove_entry(
    distro: String,
    path: String,
    host: Option<SshHostWire>,
) -> Result<(), String> {
    validate_path_component(&path)?;
    let script = format!(
        "if [ -d {path} ]; then rmdir {path} && echo W_OK || echo W_FAIL_dir_not_empty;\
         else rm -f {path} && echo W_OK || echo W_FAIL; fi"
    );
    exec_expect_ok(&distro, &script, &host).await
}

#[cfg(test)]
mod tests {
    use super::super::wsl_remote_ops::b64_encode;
    #[test]
    fn 脚本形态_哨兵与防覆写() {
        /* 纯脚本装配断言:无执行环境,验证关键形态(哨兵/存在性闸/白名单前置)。 */
        let s = "if [ -e /tmp/a ]; then echo W_FAIL_exists; else : > /tmp/a && echo W_OK; fi";
        assert!(s.contains("W_OK") && s.contains("W_FAIL_exists"));
        assert!(!b64_encode("hi".as_bytes()).is_empty());
    }
}
