//! 自建中继部署资产:Node 单文件中继源码(include_str 内嵌)、自签证书现场铸
//! (SAN=IP,rcgen 纯 Rust——Finder 启动无 brew PATH,系统 openssl 是 LibreSSL
//! 不支持 -addext,故不 shell 出去)、env/systemd unit 模板渲染。

use std::net::IpAddr;

/// 构建时内嵌的中继服务器源码(与 Cloudflare Worker 同线协议;deploy/relay/ 是
/// 唯一事实源,ECS 现网那份已收编)。
pub const SERVER_SOURCE: &str = include_str!("../../deploy/relay/tmd-relay-server.mjs");

/// 证书 + 私钥(PEM);私钥只在部署调用内存在,不落桌面盘。
pub struct RelayCert {
    pub cert_pem: String,
    pub key_pem: String,
    /// 证书 DER(算指纹/落 settings 动态钉)。
    pub der: Vec<u8>,
    /// base64(SHA-256(DER)),配对 offer 的 pin 字段。
    pub fingerprint: String,
}

/// 现场铸自签证书:SAN=IP(host),十年期。host 必须是合法 IP(本方案只支持
/// IP 直连;域名落点走 Cloudflare Worker 路径)。
pub fn mint_cert(host: &str) -> Result<RelayCert, String> {
    let ip: IpAddr = host
        .parse()
        .map_err(|_| format!("自建中继仅支持 IP 地址,收到: {host}"))?;
    let signing_key = rcgen::KeyPair::generate().map_err(|e| e.to_string())?;
    let mut params =
        rcgen::CertificateParams::new(vec![ip.to_string()]).map_err(|e| e.to_string())?;
    params.not_before = rcgen::date_time_ymd(2026, 1, 1);
    params.not_after = rcgen::date_time_ymd(2036, 1, 1);
    let cert = params
        .self_signed(&signing_key)
        .map_err(|e| e.to_string())?;
    let der = cert.der().as_ref().to_vec();
    let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, &der);
    use base64::Engine;
    Ok(RelayCert {
        cert_pem: cert.pem(),
        key_pem: signing_key.serialize_pem(),
        fingerprint: base64::engine::general_purpose::STANDARD.encode(digest.as_ref()),
        der,
    })
}

/// systemd EnvironmentFile 内容(PORT=80 家宽兜底 + RELAY_KEY;443 TLS 由 mjs
/// 自身监听,读 /opt/tmd-relay/relay-*.pem)。
pub fn render_env(key: &str) -> String {
    format!("PORT=80\nRELAY_KEY={key}\n")
}

/// systemd unit(node 绝对路径由部署脚本先 which 探测后以 {node} 注入)。
pub fn render_unit() -> String {
    "[Unit]\nDescription=tmd-cli relay\nAfter=network.target\n\n[Service]\n\
     Type=simple\nExecStart={node} /opt/tmd-relay/tmd-relay-server.mjs\n\
     EnvironmentFile=/opt/tmd-relay/env\nRestart=always\nRestartSec=3\n\n\
     [Install]\nWantedBy=multi-user.target\n"
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_cert_pins_ip_san_and_32b_fingerprint() {
        let cert = mint_cert("203.0.113.7").unwrap();
        assert!(cert.cert_pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(cert.key_pem.contains("PRIVATE KEY"));
        // SAN 里的 203.0.113.7 = CB 71 71 07
        assert!(cert.der.windows(4).any(|w| w == [203, 0, 113, 7]));
        assert_eq!(cert.fingerprint.len(), 44, "base64(SHA-256)");
        assert!(mint_cert("not-an-ip").is_err());
    }

    #[test]
    fn env_and_unit_templates() {
        assert_eq!(render_env("K1"), "PORT=80\nRELAY_KEY=K1\n");
        let unit = render_unit();
        assert!(unit.contains("ExecStart={node}"));
        assert!(unit.contains("Restart=always"));
    }
}
