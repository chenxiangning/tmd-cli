//! 远程 WSL 探测 —— 经 SSH 连 Windows 宿主跑 wsl.exe 诊断命令(平台无关,mac 客户端可直连)。
//!
//! 链路(2026-09-11 真机探针实证,192.168.1.7 / Windows OpenSSH + PowerShell DefaultShell):
//! - ssh exec 会在宿主经 DefaultShell 解析命令串(那台是 PowerShell):简单命令无碍;
//!   spawn 包装串用「单引号包 bash 命令」语义正确(PS 单引号 = 字面量,不吞 `$VAR`)。
//! - exec 不分配 PTY → wsl.exe stdout 是管道 → 纯 UTF-8/ASCII,本机 console 的
//!   UTF-16LE 编码问题不存在,直接 from_utf8。
//! - hostkey:Unknown 自动信任落库(TOFU;只读诊断命令,体验优先),Changed fail-closed
//!   → 让用户先在 SSH 会话里走信任流。认证复用 ssh::auth;KBI 主机一次性命令不支持。
//!
//! 消费方:src/plugins/wsl(WslCard 远程连接段)。远程 WSL 会话的 spawn 不走本文件 ——
//! 那是 ssh_session_create(command = wsl.exe 包装串,包装串在 kernel/wsl.ts)。

use std::sync::Arc;
use std::time::Duration;

use tokio::time::timeout;

use crate::ssh::auth::{authenticate_ssh_handle, resolve_ssh_auth_material, SshAuthOutcome};
use crate::ssh::known_hosts::{self, KnownHostStatus};
use crate::ssh::transport::{connect_ssh_handle, CapturedHostKey, SshClient, SshHostWire};
use crate::wsl::{mark_running_impl, parse_wsl_list_impl, WslInfo};

/// 单条诊断命令超时:发行版停止时 wsl.exe 会触发 VM 冷启动,可达十几秒(同本机 run_bounded 纪律)。
const EXEC_TIMEOUT: Duration = Duration::from_secs(15);
/// 整体探测上限(连接 + 认证 + 三条命令)。
const PROBE_TIMEOUT: Duration = Duration::from_secs(60);

/// 探测远程宿主的 WSL:发行版表 + 运行态 + 版本。available=false = 连上了但宿主无 WSL/无发行版。
#[tauri::command]
pub(crate) async fn wsl_remote_info(host: SshHostWire) -> Result<WslInfo, String> {
    let host = host.normalized()?;
    timeout(PROBE_TIMEOUT, probe(&host))
        .await
        .map_err(|_| "远程 WSL 探测超时".to_string())?
}

async fn probe(host: &SshHostWire) -> Result<WslInfo, String> {
    let mut handle = connect_trusting(host).await?;
    let auth = resolve_ssh_auth_material(host)?;
    match authenticate_ssh_handle(&mut handle, host, auth).await? {
        SshAuthOutcome::Authenticated => {}
        SshAuthOutcome::KeyboardInteractivePrompt(_) => {
            return Err(
                "该主机需要键盘交互认证,远程探测不支持;请先在 SSH 会话中完成认证".to_string(),
            )
        }
    }

    let (list, code) = exec_collect(&mut handle, "wsl.exe -l -v").await?;
    if code != Some(0) {
        // 宿主未装 WSL(或 wsl.exe 不在 PATH):stdout 空、stderr 报错 —— 按不可用呈报,不猜。
        return Ok(crate::wsl::unavailable());
    }
    let mut distros = parse_wsl_list_impl(&list);
    if distros.is_empty() {
        return Ok(crate::wsl::unavailable());
    }
    // 运行态名单:老版 wsl.exe 不认 --running 时静默按全停(与本机 collect 同宽容度)。
    if let Ok((run, Some(0))) = exec_collect(&mut handle, "wsl.exe -l -v --running").await {
        mark_running_impl(&mut distros, &run);
    }
    let wsl_version = exec_collect(&mut handle, "wsl.exe --version")
        .await
        .ok()
        .and_then(|(t, _)| {
            t.lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with("Copyright"))
                .map(str::to_owned)
        });

    Ok(WslInfo {
        available: true,
        wsl_version,
        distros,
        // 远程探测不跑 `-d <distro> -e sh`(可能触发冷启动拖慢探测);$HOME 由会话内自主。
        linux_home: None,
        linux_user: None,
    })
}

/// 建连 + hostkey 裁决:Unknown 自动信任重连一次;Changed 拒绝(交 SSH 会话信任流)。
async fn connect_trusting(host: &SshHostWire) -> Result<russh::client::Handle<SshClient>, String> {
    let captured = Arc::new(tokio::sync::Mutex::new(None::<CapturedHostKey>));
    match connect_ssh_handle(host, Arc::clone(&captured)).await {
        Ok(handle) => Ok(handle),
        Err(error) => {
            let hit = captured.lock().await.take();
            match hit {
                Some(c) => match c.status {
                    KnownHostStatus::Unknown => {
                        known_hosts::trust(&c.key)?;
                        let retry = Arc::new(tokio::sync::Mutex::new(None));
                        connect_ssh_handle(host, retry).await
                    }
                    _ => Err("远程主机密钥已变更:请先在 SSH 会话中完成信任确认".to_string()),
                },
                None => Err(error),
            }
        }
    }
}

/// 本机/远程执行分流:host=None 走本机 wsl.exe(仅 Windows),host=Some 走 ssh exec。
pub(crate) async fn exec_somewhere(
    command: &str,
    host: Option<SshHostWire>,
) -> Result<(String, Option<i32>), String> {
    match host {
        None => {
            #[cfg(windows)]
            {
                let owned = command.to_string();
                let (bytes, code) = tokio::task::spawn_blocking(move || {
                    crate::wsl::run_bounded(
                        &split_windows_args(&owned),
                        EXEC_TIMEOUT.as_millis() as u64,
                    )
                })
                .await
                .map_err(|e| format!("wsl join 失败: {e}"))?
                .ok_or_else(|| "本机 wsl.exe 执行超时".to_string())?;
                let text = if bytes.contains(&0) {
                    crate::wsl::decode_utf16le(&bytes)
                } else {
                    String::from_utf8_lossy(&bytes)
                        .trim_end_matches('\0')
                        .to_string()
                };
                Ok((text, code))
            }
            #[cfg(not(windows))]
            {
                let _ = command;
                Err("本机 WSL 仅 Windows 支持;mac/Linux 客户端请使用远程宿主".to_string())
            }
        }
        Some(host) => {
            let host = host.normalized()?;
            let mut handle = connect_trusting(&host).await?;
            let auth = resolve_ssh_auth_material(&host)?;
            match authenticate_ssh_handle(&mut handle, &host, auth).await? {
                SshAuthOutcome::Authenticated => {}
                SshAuthOutcome::KeyboardInteractivePrompt(_) => {
                    return Err("该主机需要键盘交互认证,远程操作不支持".to_string())
                }
            }
            exec_collect(&mut handle, command).await
        }
    }
}

/// 把本模块自构的简单 wsl.exe 命令串拆回参数数组(本机 run_bounded 需要 &[&str]);
/// 引号仅成对出现,不做通用 shell 解析。
#[cfg(windows)]
fn split_windows_args(command: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quote: Option<char> = None;
    for c in command.chars() {
        match in_quote {
            Some(q) if c == q => in_quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => in_quote = Some(c),
            None if c.is_whitespace() => {
                if !cur.is_empty() {
                    out.push(cur.as_str());
                    cur.clear();
                }
            }
            None => cur.push(c),
        }
    }
    if !cur.is_empty() {
        out.push(cur.as_str());
    }
    out
}

/// exec 一条命令收齐 stdout(UTF-8;stderr 丢弃)。返回 (stdout, exit code)。
async fn exec_collect(
    handle: &mut russh::client::Handle<SshClient>,
    command: &str,
) -> Result<(String, Option<i32>), String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("SSH 通道打开失败: {error}"))?;
    channel
        .exec(false, command)
        .await
        .map_err(|error| format!("SSH 命令执行失败: {error}"))?;

    let mut out: Vec<u8> = Vec::new();
    let mut code: Option<i32> = None;
    loop {
        let msg = timeout(EXEC_TIMEOUT, channel.wait())
            .await
            .map_err(|_| "远程命令超时".to_string())?;
        match msg {
            Some(russh::ChannelMsg::Data { ref data }) => out.extend_from_slice(data),
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                code = Some(i32::try_from(exit_status).unwrap_or(-1));
                break;
            }
            Some(russh::ChannelMsg::Close) | None => break,
            Some(_) => {}
        }
    }
    // wsl.exe 诊断输出在非交互 stdout 下默认 UTF-16LE(实测经 ssh exec 亦然,并不因
    // 管道转 UTF-8);含 NUL 即按 UTF-16LE 解,否则按 UTF-8(WSL_UTF8=1 的宿主)。
    let text = if out.contains(&0) {
        crate::wsl::decode_utf16le(&out)
    } else {
        String::from_utf8_lossy(&out)
            .trim_end_matches('\0')
            .to_string()
    };
    Ok((text, code))
}

#[cfg(test)]
#[path = "wsl_remote_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "wsl_session_store_tests.rs"]
mod store_tests;
