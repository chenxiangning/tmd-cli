//! SSH 传输层 —— russh 客户端配置、连接建立与 host key 捕获。
//! 代理(HTTP CONNECT/SOCKS5)见 proxy.rs;认证见 auth.rs。

use base64::Engine;
use russh::client;
use russh::keys::ssh_key::HashAlg;
use russh::keys::{PublicKey, PublicKeyBase64};
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpStream;

use super::known_hosts::{self, KnownHostStatus};
use super::proxy::{http_connect_proxy, resolve_ssh_proxy, socks5_connect_proxy, SshProxyKind};
use super::{SSH_KEEPALIVE_INTERVAL, SSH_KEEPALIVE_MAX_MISSES};

pub(crate) const SSH_DEFAULT_PORT: u16 = 22;

/// 前端传入的主机配置(settings.ssh.hosts 条目,camelCase;凭据明文随命令传输)。
/// id/name 等展示字段引擎不用,serde 直接忽略。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostWire {
    #[serde(default)]
    pub name: String,
    pub host: String,
    #[serde(default)]
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub auth_type: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub private_key: String,
    #[serde(default)]
    pub private_key_path: String,
    #[serde(default)]
    pub private_key_passphrase: String,
    #[serde(default)]
    pub proxy: Option<SshProxyWire>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshProxyWire {
    /// "" | "http" | "socks5"。
    #[serde(default, alias = "type")]
    pub proxy_type: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl SshHostWire {
    /// 归一化:端口缺省 22、去空白、host/username 必填校验。
    pub(crate) fn normalized(&self) -> Result<SshHostWire, String> {
        let mut host = self.clone();
        host.host = host.host.trim().to_string();
        host.username = host.username.trim().to_string();
        host.port = if host.port == 0 {
            SSH_DEFAULT_PORT
        } else {
            host.port
        };
        if host.host.is_empty() {
            return Err("SSH 主机地址不能为空".to_string());
        }
        if host.username.is_empty() {
            return Err("SSH 用户名不能为空".to_string());
        }
        Ok(host)
    }
}

/// check_server_key 捕获的 host key(未知/变更时交前端确认)。
#[derive(Debug, Clone)]
pub(crate) struct CapturedHostKey {
    pub(crate) key: known_hosts::KnownHostKey,
    pub(crate) status: KnownHostStatus,
}

/// russh 客户端 Handler:host key 校验钩子。
pub(crate) struct SshClient {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) captured_host_key: Arc<tokio::sync::Mutex<Option<CapturedHostKey>>>,
}

impl client::Handler for SshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_base64 =
            base64::engine::general_purpose::STANDARD.encode(server_public_key.public_key_bytes());
        let key = known_hosts::KnownHostKey {
            host: self.host.clone(),
            port: self.port,
            key_type: server_public_key.algorithm().as_str().to_string(),
            key_base64,
            fingerprint_sha256: server_public_key.fingerprint(HashAlg::Sha256).to_string(),
            trusted_at: 0,
        };
        match known_hosts::check(&key) {
            Ok(KnownHostStatus::Known) => Ok(true),
            Ok(status) => {
                *self.captured_host_key.lock().await = Some(CapturedHostKey { key, status });
                Ok(false)
            }
            Err(error) => {
                // 存储读取失败:按指纹变更处理(fail-closed,交用户裁决)。
                *self.captured_host_key.lock().await = Some(CapturedHostKey {
                    key,
                    status: KnownHostStatus::Changed {
                        stored_fingerprint: error,
                    },
                });
                Ok(false)
            }
        }
    }
}

pub(crate) fn ssh_client_config() -> client::Config {
    client::Config {
        keepalive_interval: Some(SSH_KEEPALIVE_INTERVAL),
        keepalive_max: SSH_KEEPALIVE_MAX_MISSES,
        nodelay: true,
        ..Default::default()
    }
}

/// 建立未认证的 russh 连接(host key 校验在握手内完成)。
pub(crate) async fn connect_ssh_handle(
    host_config: &SshHostWire,
    captured_host_key: Arc<tokio::sync::Mutex<Option<CapturedHostKey>>>,
) -> Result<client::Handle<SshClient>, String> {
    let ssh_client = SshClient {
        host: host_config.host.clone(),
        port: host_config.port,
        captured_host_key,
    };
    let config = Arc::new(ssh_client_config());
    let stream = open_ssh_transport(host_config).await?;
    client::connect_stream(config, stream, ssh_client)
        .await
        .map_err(|error| format!("SSH 连接失败: {error}"))
}

async fn open_ssh_transport(host_config: &SshHostWire) -> Result<TcpStream, String> {
    let Some(proxy) = resolve_ssh_proxy(host_config)? else {
        let stream = TcpStream::connect((host_config.host.as_str(), host_config.port))
            .await
            .map_err(|error| {
                format!(
                    "SSH TCP 连接 {}:{} 失败: {error}",
                    host_config.host, host_config.port
                )
            })?;
        let _ = stream.set_nodelay(true);
        return Ok(stream);
    };

    let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port))
        .await
        .map_err(|error| format!("SSH 代理连接 {}:{} 失败: {error}", proxy.host, proxy.port))?;
    match proxy.kind {
        SshProxyKind::Http => {
            http_connect_proxy(
                &mut stream,
                host_config.host.as_str(),
                host_config.port,
                &proxy,
            )
            .await?;
        }
        SshProxyKind::Socks5 => {
            socks5_connect_proxy(
                &mut stream,
                host_config.host.as_str(),
                host_config.port,
                &proxy,
            )
            .await?;
        }
    }
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_defaults_port_and_trims() {
        let mut host = SshHostWire {
            name: String::new(),
            host: "  example.com ".into(),
            port: 0,
            username: " root ".into(),
            auth_type: "password".into(),
            password: String::new(),
            private_key: String::new(),
            private_key_path: String::new(),
            private_key_passphrase: String::new(),
            proxy: None,
        };
        let normalized = host.normalized().unwrap();
        assert_eq!(normalized.host, "example.com");
        assert_eq!(normalized.username, "root");
        assert_eq!(normalized.port, SSH_DEFAULT_PORT);
        host.host = "  ".into();
        assert!(host.normalized().is_err());
        host.host = "ok".into();
        host.username = " ".into();
        assert!(host.normalized().is_err());
    }
}
