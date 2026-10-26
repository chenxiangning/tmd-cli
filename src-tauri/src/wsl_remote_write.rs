//! 远程 WSL 写操作(项 5 写回闭环)—— 自 wsl_remote_ops.rs 拆出(300 行铁则)。
//! 两原语:文本写回(wsl_write_file_text,分块追加 + 末尾 mv 原子替换)/
//! 新建条目(wsl_create_entry,绝不覆写已存在)。通道复用 wsl_bash_payload
//! (b64 载荷防 PS 拆引号);成败经尾部哨兵行回传(通道退出码语义不透明,不依赖)。
//! 写类命令走 60s 独立超时(exec_somewhere_write):发行版冷启动叠加分块落盘,
//! 读侧 15s 预算必超。

use super::wsl_remote::exec_somewhere_write;
use super::wsl_remote_ops::{b64_decode, b64_encode, validate_path_component, wsl_bash_payload};
use crate::ssh::transport::SshHostWire;

/// 单块解码后上限(字节):整串内嵌超 ~18KB 会撞命令行长度限制,分块绕开。
pub(crate) const CHUNK_BYTES: usize = 6 * 1024;
/// 远程写回总量上限:与读侧文件读取预算对齐(读多少、写多少),超出直接拒绝。
pub(crate) const MAX_REMOTE_WRITE_BYTES: usize = 512 * 1024;

/// 执行并断言哨兵(脚本约定末行 echo W_OK / W_FAIL:<原因>;非 OK 报错带原因)。
async fn exec_expect_ok(
    distro: &str,
    script: &str,
    host: &Option<SshHostWire>,
) -> Result<(), String> {
    let command = wsl_bash_payload(distro, script);
    let (text, _) = exec_somewhere_write(&command, host.clone()).await?;
    let ok = text
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix("W_"))
        .is_some_and(|tail| tail.starts_with("OK"));
    if ok {
        return Ok(());
    }
    // 失败分支哨兵自带 stderr 末行人话(W_FAIL:<原因>);兜底展示末行防只报哨兵码。
    let reason = text
        .lines()
        .rev()
        .find_map(|l| l.trim().strip_prefix("W_FAIL"))
        .unwrap_or_else(|| text.lines().last().unwrap_or("(无输出)"));
    Err(format!("远程写操作失败: {reason}"))
}

/// 内容切块:按 CHUNK_BYTES(解码后)切片并逐块重新编码。
pub(crate) fn encode_chunks(bytes: &[u8]) -> Vec<String> {
    bytes.chunks(CHUNK_BYTES).map(b64_encode).collect()
}

/// 纯函数:装配分块写脚本。首块建 .wtmp,余块追加,末尾 mv 原子替换(中途失败
/// 只留 .wtmp,不伤原文件);失败哨兵附 stderr 末行(W_FAIL:<原因>)。
pub(crate) fn build_write_script(path: &str, chunks: &[String]) -> String {
    let tmp = format!("{path}.wtmp");
    let mut parts = vec![format!("mkdir -p \"$(dirname {path})\"")];
    for (i, c) in chunks.iter().enumerate() {
        let redir = if i == 0 { ">" } else { ">>" };
        parts.push(format!("printf '%s' '{c}' | base64 -d {redir} {tmp}"));
    }
    parts.push(format!("mv {tmp} {path}"));
    let body = parts.join(" && ");
    format!("out=$({body} 2>&1) && echo W_OK || echo \"W_FAIL:$(printf '%s' \"$out\" | tail -1)\"")
}

/// 远程文本写回:分块 b64 解码落盘(覆盖写,语义对齐本地 fs_edit::write_file)。
#[tauri::command]
pub(crate) async fn wsl_write_file_text(
    distro: String,
    path: String,
    content_b64: String,
    host: Option<SshHostWire>,
) -> Result<(), String> {
    validate_path_component(&path)?;
    let bytes = b64_decode(&content_b64).map_err(|e| format!("内容不是合法 base64: {e}"))?;
    if bytes.len() > MAX_REMOTE_WRITE_BYTES {
        return Err(format!(
            "内容 {}KB 超出远程写回上限 {}KB,已拒绝",
            bytes.len() / 1024,
            MAX_REMOTE_WRITE_BYTES / 1024
        ));
    }
    let chunks = encode_chunks(&bytes);
    let script = build_write_script(&path, &chunks);
    exec_expect_ok(&distro, &script, &host).await
}

/// 远程新建条目:文件 noclobber 闭 TOCTOU 窗(检查与创建间被并发建=报已存在,
/// 与前置 [ -e ] 同语义);目录 mkdir -p。失败哨兵附 stderr 末行。
#[tauri::command]
pub(crate) async fn wsl_create_entry(
    distro: String,
    path: String,
    is_dir: bool,
    host: Option<SshHostWire>,
) -> Result<(), String> {
    validate_path_component(&path)?;
    let script = if is_dir {
        build_create_script_dir(&path)
    } else {
        build_create_script_file(&path)
    };
    exec_expect_ok(&distro, &script, &host).await
}

/// 纯函数:新建目录脚本(幂等 mkdir -p,失败附 stderr 末行)。
pub(crate) fn build_create_script_dir(path: &str) -> String {
    format!(
        "out=$(mkdir -p {path} 2>&1) && echo W_OK \
         || echo \"W_FAIL:$(printf '%s' \"$out\" | tail -1)\""
    )
}

/// 纯函数:新建文件脚本(noclobber 闭 TOCTOU 窗:检查与创建间被并发建=报已存在)。
pub(crate) fn build_create_script_file(path: &str) -> String {
    format!(
        "if [ -e {path} ]; then echo W_FAIL_exists; \
         else (set -o noclobber; : > {path}) 2>/dev/null && echo W_OK || echo W_FAIL_exists; fi"
    )
}

#[cfg(test)]
mod tests {
    use super::super::wsl_remote_ops::{b64_decode, b64_encode};
    use super::*;

    #[test]
    fn 写脚本_分块形态与原子收尾() {
        let chunks = vec!["AAAA".to_string(), "BBBB".to_string(), "CCCC".to_string()];
        let s = build_write_script("/tmp/a", &chunks);
        // 首块建临时文件、余块追加、末尾 mv 原子替换
        assert!(s.contains("base64 -d > /tmp/a.wtmp"));
        assert_eq!(s.matches("base64 -d >> /tmp/a.wtmp").count(), 2);
        assert!(s.contains("mv /tmp/a.wtmp /tmp/a"));
        // 哨兵协议:成功 W_OK;失败附 stderr 末行人话
        assert!(s.contains("&& echo W_OK"));
        assert!(s.contains("W_FAIL:$(printf '%s' \"$out\" | tail -1)"));
        // 单块无追加
        let one = build_write_script("/tmp/b", &["AAAA".to_string()]);
        assert!(one.contains("base64 -d > /tmp/b.wtmp"));
        assert!(!one.contains(">>"));
    }

    #[test]
    fn 切块_按解码后6kb切且可无损还原() {
        let data: Vec<u8> = (0..CHUNK_BYTES + 1).map(|i| (i % 251) as u8).collect();
        let chunks = encode_chunks(&data);
        assert_eq!(chunks.len(), 2);
        let rejoined: Vec<u8> = chunks.iter().flat_map(|c| b64_decode(c).unwrap()).collect();
        assert_eq!(rejoined, data);
        // 不足一块时单块整装
        assert_eq!(encode_chunks(b"hi").len(), 1);
        assert!(!b64_encode(b"hi").is_empty());
    }

    #[test]
    fn 新建脚本_noclobber闭窗防并发撞建() {
        let s = super::build_create_script_file("/tmp/a");
        assert!(s.contains("W_FAIL_exists"));
        assert!(s.contains("set -o noclobber"));
        assert!(s.contains(": > /tmp/a"));
        // 失败分支不再只有裸哨兵码:目录路径同样带 stderr 末行
        assert!(super::build_create_script_dir("/tmp/d").contains("W_FAIL:"));
    }

    #[test]
    fn 写上限_与读侧预算对齐() {
        // 512KB 常量钉死:改值须同步读侧预算并过复审
        assert_eq!(MAX_REMOTE_WRITE_BYTES, 512 * 1024);
        assert_eq!(CHUNK_BYTES, 6 * 1024);
        assert_eq!(super::super::wsl_remote::WRITE_TIMEOUT.as_secs(), 60);
    }
}
