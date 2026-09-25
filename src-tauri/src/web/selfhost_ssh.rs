//! 自建中继部署的 SSH 通道:一次性 exec(连接 → 认证 → 跑命令 → 收
//! stdout/stderr/exit),复用 ssh 引擎的传输/认证/known_hosts 栈。不引会话
//! 状态机 —— 部署是机器驱动的单发命令,PTY 解析噪声大且无退出码契约。

use std::sync::Arc;

use russh::client;
use russh::ChannelMsg;

use crate::ssh::auth::{authenticate_ssh_handle, resolve_ssh_auth_material, SshAuthOutcome};
use crate::ssh::known_hosts;
use crate::ssh::transport::{connect_ssh_handle, CapturedHostKey, SshHostWire};

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit: i32,
}

pub(crate) async fn connect_authed(
    host: &SshHostWire,
    trust_host_key: bool,
) -> Result<client::Handle<crate::ssh::transport::SshClient>, String> {
    for attempt in 0..2 {
        let captured = Arc::new(tokio::sync::Mutex::new(None::<CapturedHostKey>));
        let mut handle = match connect_ssh_handle(host, Arc::clone(&captured)).await {
            Ok(handle) => handle,
            Err(error) => {
                let cap = captured.lock().await.clone();
                if let Some(cap) = cap {
                    if attempt == 0 && trust_host_key {
                        known_hosts::trust(&cap.key)
                            .map_err(|e| format!("记录主机指纹失败: {e}"))?;
                        continue;
                    }
                    return Err(format!(
                        "SSH 主机指纹未确认({}):{}",
                        cap.key.fingerprint_sha256, error
                    ));
                }
                return Err(error);
            }
        };
        let material = resolve_ssh_auth_material(host)?;
        match authenticate_ssh_handle(&mut handle, host, material).await? {
            SshAuthOutcome::Authenticated => return Ok(handle),
            SshAuthOutcome::KeyboardInteractivePrompt(_) => {
                return Err("部署仅支持密码/私钥认证(键盘交互需人工)".to_string())
            }
        }
    }
    Err("SSH 连接重试耗尽".to_string())
}

async fn collect(mut channel: russh::Channel<client::Msg>) -> Result<ExecOutput, String> {
    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut exit = -1;
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => stdout.push_str(&String::from_utf8_lossy(&data)),
            ChannelMsg::ExtendedData { data, .. } => {
                stderr.push_str(&String::from_utf8_lossy(&data))
            }
            ChannelMsg::ExitStatus { exit_status } => exit = exit_status as i32,
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(ExecOutput {
        stdout,
        stderr,
        exit,
    })
}

/// 单条命令:exec → 收集到 ExitStatus(约定 exit 0 为成功)。
pub(crate) async fn exec(
    handle: &client::Handle<crate::ssh::transport::SshClient>,
    command: &str,
) -> Result<ExecOutput, String> {
    let channel = open_exec(handle, command).await?;
    collect(channel).await
}

/// exec 后向 stdin 灌整段内容再 EOF:部署落盘文件走这条路(命令体无长度限制,
/// 原始字节直写,免 base64 中转)。
pub(crate) async fn exec_with_input(
    handle: &client::Handle<crate::ssh::transport::SshClient>,
    command: &str,
    input: &[u8],
) -> Result<ExecOutput, String> {
    let channel = open_exec(handle, command).await?;
    channel
        .data(std::io::Cursor::new(input.to_vec()))
        .await
        .map_err(|e| format!("写入失败: {e}"))?;
    channel.eof().await.map_err(|e| format!("EOF 失败: {e}"))?;
    collect(channel).await
}

async fn open_exec(
    handle: &client::Handle<crate::ssh::transport::SshClient>,
    command: &str,
) -> Result<russh::Channel<client::Msg>, String> {
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("打开通道失败: {e}"))?;
    channel
        .exec(true, command.to_string())
        .await
        .map_err(|e| format!("exec 失败: {e}"))?;
    Ok(channel)
}
