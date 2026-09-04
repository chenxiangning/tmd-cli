//! SSH 代理 —— HTTP CONNECT / SOCKS5 握手与代理解析。
//! 手写代理协议握手,错误文案中文化。

use base64::Engine;
use std::net::{IpAddr, Ipv6Addr};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SshProxyKind {
    Socks5,
    Http,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSshProxy {
    pub(crate) kind: SshProxyKind,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: String,
}

/// 解析主机配置里的代理;None = 直连。配了但不合法 → 快速失败,不静默直连。
pub(crate) fn resolve_ssh_proxy(
    host: &super::transport::SshHostWire,
) -> Result<Option<ResolvedSshProxy>, String> {
    let Some(proxy) = host.proxy.as_ref() else {
        return Ok(None);
    };
    if proxy.proxy_type.trim().is_empty() && proxy.url.trim().is_empty() && proxy.port == 0 {
        return Ok(None);
    }
    let raw_url = proxy.url.trim();
    if raw_url.is_empty() {
        return Err("SSH 代理地址不能为空".to_string());
    }
    let (scheme, authority) = split_proxy_scheme(raw_url);
    let kind = resolve_proxy_kind(proxy.proxy_type.as_str(), scheme)?;
    let authority = authority
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(authority)
        .trim();
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let (proxy_host, url_port) = split_host_port(authority);
    if proxy_host.trim().is_empty() {
        return Err("SSH 代理地址不能为空".to_string());
    }
    let default_port = match kind {
        SshProxyKind::Socks5 => 1080,
        SshProxyKind::Http => 8080,
    };
    Ok(Some(ResolvedSshProxy {
        kind,
        host: proxy_host,
        port: if proxy.port > 0 {
            proxy.port
        } else {
            url_port.unwrap_or(default_port)
        },
        username: proxy.username.trim().to_string(),
        password: proxy.password.trim().to_string(),
    }))
}

pub(crate) fn split_proxy_scheme(input: &str) -> (Option<&str>, &str) {
    if let Some(index) = input.find("://") {
        let (scheme, rest) = input.split_at(index);
        return (Some(scheme), &rest[3..]);
    }
    (None, input)
}

pub(crate) fn resolve_proxy_kind(
    raw_type: &str,
    scheme: Option<&str>,
) -> Result<SshProxyKind, String> {
    let source = scheme.unwrap_or(raw_type).trim().to_ascii_lowercase();
    match source.as_str() {
        "http" => Ok(SshProxyKind::Http),
        "" | "socks5" | "socks" => Ok(SshProxyKind::Socks5),
        other => Err(format!("不支持的 SSH 代理类型: {other}")),
    }
}

pub(crate) fn split_host_port(authority: &str) -> (String, Option<u16>) {
    let authority = authority.trim();
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            let host = rest[..end].to_string();
            let port = rest[end + 1..].strip_prefix(':').and_then(parse_u16_port);
            return (host, port);
        }
    }
    if let Some((host, port)) = authority.rsplit_once(':') {
        if !host.contains(':') {
            return (host.to_string(), parse_u16_port(port));
        }
    }
    (authority.to_string(), None)
}

pub(crate) fn parse_u16_port(value: &str) -> Option<u16> {
    value.trim().parse::<u16>().ok().filter(|port| *port >= 1)
}

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

pub(crate) fn write_socks5_address(out: &mut Vec<u8>, host: &str) -> Result<(), String> {
    let normalized_host = strip_ipv6_brackets(host.trim());
    if let Ok(ip) = normalized_host.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(ip) => {
                out.push(0x01);
                out.extend_from_slice(&ip.octets());
            }
            IpAddr::V6(ip) => {
                out.push(0x04);
                out.extend_from_slice(&ip.octets());
            }
        }
        return Ok(());
    }
    if normalized_host.is_empty() || normalized_host.len() > u8::MAX as usize {
        return Err("SSH SOCKS5 目标主机为空或过长".to_string());
    }
    out.push(0x03);
    out.push(normalized_host.len() as u8);
    out.extend_from_slice(normalized_host.as_bytes());
    Ok(())
}

pub(crate) fn strip_ipv6_brackets(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
}

pub(crate) fn host_port_authority(host: &str, port: u16) -> String {
    let host = host.trim();
    if strip_ipv6_brackets(host).parse::<Ipv6Addr>().is_ok() && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
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

#[cfg(test)]
mod tests {
    use super::super::transport::{SshHostWire, SshProxyWire};
    use super::*;

    fn host_with_proxy(proxy: SshProxyWire) -> SshHostWire {
        SshHostWire {
            name: String::new(),
            host: "prod.example.com".into(),
            port: 22,
            username: "root".into(),
            auth_type: "password".into(),
            password: String::new(),
            private_key: String::new(),
            private_key_path: String::new(),
            private_key_passphrase: String::new(),
            proxy: Some(proxy),
        }
    }

    #[test]
    fn proxy_kind_resolution() {
        assert_eq!(resolve_proxy_kind("", None), Ok(SshProxyKind::Socks5));
        assert_eq!(resolve_proxy_kind("socks5", None), Ok(SshProxyKind::Socks5));
        assert_eq!(resolve_proxy_kind("", Some("HTTP")), Ok(SshProxyKind::Http));
        assert!(resolve_proxy_kind("vpn", None).is_err());
    }

    #[test]
    fn proxy_resolution_prefers_scheme_and_explicit_port() {
        let host = host_with_proxy(SshProxyWire {
            proxy_type: String::new(),
            url: "http://user:pass@127.0.0.1:8888/path".into(),
            port: 0,
            username: "u".into(),
            password: String::new(),
        });
        let proxy = resolve_ssh_proxy(&host).unwrap().unwrap();
        assert_eq!(proxy.kind, SshProxyKind::Http);
        assert_eq!(proxy.host, "127.0.0.1");
        assert_eq!(proxy.port, 8888);
        // 认证取 proxy.username/password 字段,不解析 URL 内嵌凭据。
        assert_eq!(proxy.username, "u");
    }

    #[test]
    fn proxy_resolution_defaults_ports() {
        let socks = host_with_proxy(SshProxyWire {
            proxy_type: "socks5".into(),
            url: "127.0.0.1".into(),
            port: 0,
            username: String::new(),
            password: String::new(),
        });
        assert_eq!(resolve_ssh_proxy(&socks).unwrap().unwrap().port, 1080);
        let http = host_with_proxy(SshProxyWire {
            proxy_type: "http".into(),
            url: "proxy.local".into(),
            port: 3128,
            username: String::new(),
            password: String::new(),
        });
        assert_eq!(resolve_ssh_proxy(&http).unwrap().unwrap().port, 3128);
    }

    #[test]
    fn proxy_unset_means_direct() {
        let host = host_with_proxy(SshProxyWire {
            proxy_type: String::new(),
            url: String::new(),
            port: 0,
            username: String::new(),
            password: String::new(),
        });
        assert!(resolve_ssh_proxy(&host).unwrap().is_none());
    }

    #[test]
    fn socks5_address_encoding() {
        let mut out = Vec::new();
        write_socks5_address(&mut out, "192.168.1.1").unwrap();
        assert_eq!(out, vec![0x01, 192, 168, 1, 1]);
        let mut out = Vec::new();
        write_socks5_address(&mut out, "[::1]").unwrap();
        assert_eq!(out[0], 0x04);
        let mut out = Vec::new();
        write_socks5_address(&mut out, "db.internal").unwrap();
        assert_eq!(out[0], 0x03);
        assert_eq!(out[1], 11);
    }

    #[test]
    fn host_port_splitting_handles_ipv6() {
        assert_eq!(split_host_port("[::1]:2222"), ("::1".into(), Some(2222)));
        assert_eq!(split_host_port("proxy.local"), ("proxy.local".into(), None));
        assert_eq!(host_port_authority("::1", 22), "[::1]:22");
    }
}
