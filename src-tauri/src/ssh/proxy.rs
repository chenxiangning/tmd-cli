//! SSH 代理 —— HTTP CONNECT / SOCKS5 握手与代理解析。
//! 手写代理协议握手,错误文案中文化。
//! 握手交互(http_connect_proxy / socks5_connect_proxy)→ proxy_handshake.rs(文件规模铁则)。

use std::net::{IpAddr, Ipv6Addr};

/// 握手函数 re-export:保持 super::proxy::{http_connect_proxy, …} 引用路径不变。
pub(crate) use super::proxy_handshake::{http_connect_proxy, socks5_connect_proxy};

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
