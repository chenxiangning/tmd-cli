//! ssh 域命令桥(会话/提示/SFTP/转发)。命令名与参数键逐一对齐 kernel/ipc.ts 的 invoke 调用。

use std::future::Future;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::dispatch::{args, ser, val};

pub(super) async fn try_dispatch(
    app: &AppHandle,
    cmd: &str,
    raw: &Value,
) -> Option<Result<Value, String>> {
    if !matches!(
        cmd,
        "ssh_session_create"
            | "ssh_session_reconnect"
            | "ssh_prompt_answer"
            | "ssh_prompt_cancel"
            | "ssh_latency"
            | "ssh_prompts_pending"
            | "ssh_known_hosts_reset"
            | "ssh_sftp_list"
            | "ssh_sftp_read_text"
            | "ssh_sftp_write_text"
            | "ssh_sftp_mkdir"
            | "ssh_sftp_rename"
            | "ssh_sftp_delete"
            | "ssh_sftp_transfer"
            | "ssh_sftp_transfer_cancel"
            | "ssh_forward_start"
            | "ssh_forward_stop"
            | "ssh_forward_list"
            | "ssh_forward_check_port"
    ) {
        return None;
    }
    Some(dispatch_inner(app, cmd, raw).await)
}

async fn dispatch_inner(app: &AppHandle, cmd: &str, raw: &Value) -> Result<Value, String> {
    use crate::ssh::commands as c;
    match cmd {
        "ssh_session_create" => {
            let a = args::<CreateArgs>(raw)?;
            ser(c::ssh_session_create(
                app.clone(),
                app.state(),
                a.host,
                a.cwd,
                a.workspace_id,
                a.cols,
                a.rows,
                a.command,
                a.engine_profile,
            )
            .await)
        }
        "ssh_session_reconnect" => {
            let a = args::<ReconnectArgs>(raw)?;
            ser(c::ssh_session_reconnect(
                app.clone(),
                app.state(),
                a.session_id,
                a.cwd,
                a.workspace_id,
            )
            .await)
        }
        "ssh_prompt_answer" => {
            let a = args::<AnswerArgs>(raw)?;
            ser(c::ssh_prompt_answer(
                app.state(),
                a.prompt_id,
                a.answer,
                a.trust_host_key,
            ))
        }
        "ssh_prompt_cancel" => ser(c::ssh_prompt_cancel(
            app.state(),
            args::<PromptId>(raw)?.prompt_id,
        )),
        "ssh_latency" => {
            let a = args::<SessionId>(raw)?;
            ser(c::ssh_latency(app.state(), a.session_id).await)
        }
        "ssh_prompts_pending" => val(c::ssh_prompts_pending(app.state())),
        "ssh_known_hosts_reset" => {
            let a = args::<HostPort>(raw)?;
            ser(c::ssh_known_hosts_reset(a.host, a.port))
        }
        "ssh_sftp_list" => go(raw, |a: SftpList| c::ssh_sftp_list(a.session_id, a.path)).await,
        "ssh_sftp_read_text" => {
            go(raw, |a: SftpRead| {
                c::ssh_sftp_read_text(a.session_id, a.path, a.offset, a.max_bytes)
            })
            .await
        }
        "ssh_sftp_write_text" => {
            go(raw, |a: SftpWrite| {
                c::ssh_sftp_write_text(
                    a.session_id,
                    a.path,
                    a.content,
                    a.expected_mtime,
                    a.expected_size,
                )
            })
            .await
        }
        "ssh_sftp_mkdir" => go(raw, |a: SftpPath| c::ssh_sftp_mkdir(a.session_id, a.path)).await,
        "ssh_sftp_rename" => {
            go(raw, |a: SftpRename| {
                c::ssh_sftp_rename(a.session_id, a.from_path, a.to_path)
            })
            .await
        }
        "ssh_sftp_delete" => {
            go(raw, |a: SftpDelete| {
                c::ssh_sftp_delete(a.session_id, a.path, a.recursive)
            })
            .await
        }
        "ssh_sftp_transfer" => {
            let a = args::<SftpTransfer>(raw)?;
            ser(c::ssh_sftp_transfer(
                a.session_id,
                a.direction,
                a.source_path,
                a.target_path,
                a.recursive,
            ))
        }
        "ssh_sftp_transfer_cancel" => {
            let a = args::<TransferCancel>(raw)?;
            ser(c::ssh_sftp_transfer_cancel(a.session_id, a.transfer_id))
        }
        "ssh_forward_start" => {
            let a = args::<ForwardStart>(raw)?;
            ser(
                c::ssh_forward_start(a.session_id, a.remote_host, a.remote_port, a.local_port)
                    .await,
            )
        }
        "ssh_forward_stop" => {
            let a = args::<ForwardStop>(raw)?;
            ser(c::ssh_forward_stop(a.session_id, a.forward_id))
        }
        "ssh_forward_list" => val(c::ssh_forward_list(args::<SessionId>(raw)?.session_id)),
        "ssh_forward_check_port" => {
            val(c::ssh_forward_check_port(args::<OnePort>(raw)?.port).await)
        }
        _ => Err(format!("internal: gated command without arm: {cmd}")), /* 同 dispatch_session F5:漂移不 panic(spawn 任务里 unreachable = response 永挂) */
    }
}

async fn go<A: serde::de::DeserializeOwned, T, F, Fut>(raw: &Value, f: F) -> Result<Value, String>
where
    F: FnOnce(A) -> Fut,
    Fut: Future<Output = Result<T, String>>,
    T: serde::Serialize,
{
    ser(f(args::<A>(raw)?).await)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArgs {
    host: crate::ssh::transport::SshHostWire,
    cwd: String,
    workspace_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    command: Option<String>,
    engine_profile: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReconnectArgs {
    session_id: String,
    cwd: String,
    workspace_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnswerArgs {
    prompt_id: String,
    answer: Option<String>,
    trust_host_key: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptId {
    prompt_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionId {
    session_id: String,
}

#[derive(serde::Deserialize)]
struct HostPort {
    host: String,
    port: u16,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpList {
    session_id: String,
    path: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpRead {
    session_id: String,
    path: String,
    offset: Option<u64>,
    max_bytes: Option<usize>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpWrite {
    session_id: String,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpPath {
    session_id: String,
    path: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpRename {
    session_id: String,
    from_path: String,
    to_path: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpDelete {
    session_id: String,
    path: String,
    recursive: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpTransfer {
    session_id: String,
    direction: String,
    source_path: String,
    target_path: String,
    recursive: Option<bool>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferCancel {
    session_id: String,
    transfer_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardStart {
    session_id: String,
    remote_host: String,
    remote_port: u16,
    local_port: Option<u16>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForwardStop {
    session_id: String,
    forward_id: String,
}

#[derive(serde::Deserialize)]
struct OnePort {
    port: u16,
}
