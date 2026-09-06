//! SSH 代理握手 —— HTTP CONNECT / SOCKS5 协议交互(手写,错误文案中文化)。
//! 自 proxy.rs 拆出(文件规模铁则);代理解析与地址工具留在 proxy.rs。

use base64::Engine;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::proxy::{host_port_authority, write_socks5_address, ResolvedSshProxy};

pub(crate) async fn http_connect_proxy(
    stream: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    proxy: &ResolvedSshProxy,
) -> Result<(), String> {
    let target = host_port_authority(target_host, target_port);
    let mut request =
        format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\nProxy-Connection: Keep-Alive\r\n");
    if !proxy.username.is_empty() || !proxy.password.is_empty() {
        let token = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", proxy.username, proxy.password));
        request.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| format!("SSH HTTP 代理 CONNECT 请求失败: {error}"))?;

    let mut response = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    while !response.ends_with(b"\r\n\r\n") {
        if response.len() >= 16 * 1024 {
            return Err("SSH HTTP 代理 CONNECT 响应过大".to_string());
        }
        let n = stream
            .read(&mut byte)
            .await
            .map_err(|error| format!("SSH HTTP 代理 CONNECT 响应读取失败: {error}"))?;
        if n == 0 {
            return Err("SSH HTTP 代理在 CONNECT 完成前断开".to_string());
        }
        response.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&response);
    let status_line = text.lines().next().unwrap_or_default();
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(0);
    if !(200..300).contains(&status_code) {
        return Err(format!(
            "SSH HTTP 代理 CONNECT 失败: {}",
            status_line.trim()
        ));
    }
    Ok(())
}

pub(crate) async fn socks5_connect_proxy(
    stream: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    proxy: &ResolvedSshProxy,
) -> Result<(), String> {
    let wants_auth = !proxy.username.is_empty() || !proxy.password.is_empty();
    if wants_auth
        && (proxy.username.len() > u8::MAX as usize || proxy.password.len() > u8::MAX as usize)
    {
        return Err("SSH SOCKS5 代理用户名/密码过长".to_string());
    }
    let greeting: &[u8] = if wants_auth {
        &[0x05, 0x02, 0x00, 0x02]
    } else {
        &[0x05, 0x01, 0x00]
    };
    stream
        .write_all(greeting)
        .await
        .map_err(|error| format!("SSH SOCKS5 代理握手失败: {error}"))?;
    let mut method = [0u8; 2];
    stream
        .read_exact(&mut method)
        .await
        .map_err(|error| format!("SSH SOCKS5 代理方法协商失败: {error}"))?;
    if method[0] != 0x05 {
        return Err("SSH SOCKS5 代理返回了无效版本".to_string());
    }
    match method[1] {
        0x00 => {}
        0x02 => {
            let mut auth = Vec::with_capacity(3 + proxy.username.len() + proxy.password.len());
            auth.push(0x01);
            auth.push(proxy.username.len() as u8);
            auth.extend_from_slice(proxy.username.as_bytes());
            auth.push(proxy.password.len() as u8);
            auth.extend_from_slice(proxy.password.as_bytes());
            stream
                .write_all(&auth)
                .await
                .map_err(|error| format!("SSH SOCKS5 代理认证请求失败: {error}"))?;
            let mut auth_response = [0u8; 2];
            stream
                .read_exact(&mut auth_response)
                .await
                .map_err(|error| format!("SSH SOCKS5 代理认证响应失败: {error}"))?;
            if auth_response != [0x01, 0x00] {
                return Err("SSH SOCKS5 代理认证失败".to_string());
            }
        }
        0xff => return Err("SSH SOCKS5 代理没有可接受的认证方式".to_string()),
        other => {
            return Err(format!("SSH SOCKS5 代理选择了不支持的认证方式: {other}"));
        }
    }

    let mut request = Vec::new();
    request.extend_from_slice(&[0x05, 0x01, 0x00]);
    write_socks5_address(&mut request, target_host)?;
    request.extend_from_slice(&target_port.to_be_bytes());
    stream
        .write_all(&request)
        .await
        .map_err(|error| format!("SSH SOCKS5 代理 CONNECT 请求失败: {error}"))?;

    let mut response = [0u8; 4];
    stream
        .read_exact(&mut response)
        .await
        .map_err(|error| format!("SSH SOCKS5 代理 CONNECT 响应失败: {error}"))?;
    if response[0] != 0x05 {
        return Err("SSH SOCKS5 代理返回了无效的 CONNECT 版本".to_string());
    }
    if response[1] != 0x00 {
        return Err(format!(
            "SSH SOCKS5 代理 CONNECT 失败: {}",
            socks5_reply_label(response[1])
        ));
    }
    let address_len = match response[3] {
        0x01 => 4,
        0x03 => {
            let mut len = [0u8; 1];
            stream
                .read_exact(&mut len)
                .await
                .map_err(|error| format!("SSH SOCKS5 代理响应失败: {error}"))?;
            usize::from(len[0])
        }
        0x04 => 16,
        other => {
            return Err(format!("SSH SOCKS5 代理返回了不支持的地址类型: {other}"));
        }
    };
    let mut discard = vec![0u8; address_len + 2];
    stream
        .read_exact(&mut discard)
        .await
        .map_err(|error| format!("SSH SOCKS5 代理响应失败: {error}"))?;
    Ok(())
}

fn socks5_reply_label(code: u8) -> &'static str {
    match code {
        0x01 => "general failure",
        0x02 => "connection not allowed",
        0x03 => "network unreachable",
        0x04 => "host unreachable",
        0x05 => "connection refused",
        0x06 => "TTL expired",
        0x07 => "command not supported",
        0x08 => "address type not supported",
        _ => "unknown error",
    }
}
