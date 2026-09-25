//! 自建中继的证书钉住:运营商对所有端口做 WS 深包检测(80 吞 upgrade、443 嗅探
//! TLS),明文无解 → 443 上真 TLS(自签证书)。信任模型 = 不信任公共 CA,只认
//! 部署时烧进二进制的这张证书(SHA-256 指纹),其余主机走默认 webpki 根。

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::RootCertStore;

/// ECS 自建中继地址(与 deploy/relay/ 下证书 SAN 一致)。
pub const PINNED_HOST: &str = "123.249.45.144";
/// 证书 DER(自签,十年期;换证书 = 换这个文件重新发版)。
const PINNED_CERT_DER: &[u8] = include_bytes!("../../deploy/relay/relay-cert.der");

fn sha256(bytes: &[u8]) -> Vec<u8> {
    aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, bytes)
        .as_ref()
        .to_vec()
}

/// 钉住表:host -> 证书 SHA-256。内置 ECS 一张 + settings 动态一张(一键部署铸)。
#[derive(Debug)]
struct PinnedVerifier {
    default: Arc<WebPkiServerVerifier>,
    pins: Vec<(String, Vec<u8>)>,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let host = match server_name {
            ServerName::IpAddress(ip) => std::net::IpAddr::from(*ip).to_string(),
            ServerName::DnsName(name) => name.as_ref().to_string(),
            _ => String::new(),
        };
        if let Some((_, hash)) = self.pins.iter().find(|(h, _)| *h == host) {
            // 指纹一致即信任(自签无链可走);握手签名校验仍委托默认 verifier。
            if sha256(end_entity.as_ref()) == *hash {
                return Ok(ServerCertVerified::assertion());
            }
            return Err(rustls::Error::General(
                "中继证书与内置指纹不符(疑似中间人)".into(),
            ));
        }
        self.default
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.default.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.default.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.default.supported_verify_schemes()
    }
}

/// 拨号用 ClientConfig:公共 CA 默认链 + 钉住表(内置 ECS + 可选动态)。
/// 动态钉:一键部署把新服务器证书 DER 落 settings 后,拨号额外信任 (host, der)。
pub fn pinned_client_config_with(extra: Option<(&str, &[u8])>) -> Arc<rustls::ClientConfig> {
    /* 重拨循环 ≤30s 一次:根库构建(~150 根证书解析)与默认 verifier 全局只做一次。 */
    static ROOTS: std::sync::LazyLock<Arc<RootCertStore>> = std::sync::LazyLock::new(|| {
        let mut roots = RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        Arc::new(roots)
    });
    static DEFAULT: std::sync::LazyLock<Arc<WebPkiServerVerifier>> =
        std::sync::LazyLock::new(|| {
            WebPkiServerVerifier::builder(ROOTS.clone())
                .build()
                .expect("webpki verifier")
        });
    let default = DEFAULT.clone();
    let roots = ROOTS.clone();
    let mut pins = vec![(PINNED_HOST.to_string(), sha256(PINNED_CERT_DER))];
    if let Some((host, der)) = extra {
        match pins.iter_mut().find(|(h, _)| h == host) {
            Some(slot) => slot.1 = sha256(der),
            None => pins.push((host.to_string(), sha256(der))),
        }
    }
    let mut cfg = rustls::ClientConfig::builder()
        // 占位根(同库);实际校验整体替换为 PinnedVerifier。
        .with_root_certificates(roots)
        .with_no_client_auth();
    cfg.dangerous()
        .set_certificate_verifier(Arc::new(PinnedVerifier { default, pins }));
    Arc::new(cfg)
}

/// 从 settings 读动态钉(webRelayCertHost/webRelayCertDer);缺省/坏值 = None。
pub fn dynamic_pin() -> Option<(String, Vec<u8>)> {
    let settings = crate::settings::load_settings();
    let host = settings["webRelayCertHost"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();
    let der_b64 = settings["webRelayCertDer"].as_str().unwrap_or("").trim();
    if host.is_empty() || der_b64.is_empty() {
        return None;
    }
    let der = super::relay_core::b64_to_bytes(der_b64);
    (!der.is_empty()).then_some((host, der))
}

/// 配对 offer 用:relay 基址(https://host[:port])命中动态钉 → (base64 指纹, der)。
pub fn dynamic_pin_for(relay_base: &str) -> Option<(String, Vec<u8>)> {
    let host = relay_base
        .trim_start_matches("https://")
        .split(['/', ':'])
        .next()?
        .to_string();
    let (pin_host, der) = dynamic_pin()?;
    (pin_host == host).then(|| {
        use base64::Engine;
        let digest = aws_lc_rs::digest::digest(&aws_lc_rs::digest::SHA256, &der);
        (
            base64::engine::general_purpose::STANDARD.encode(digest.as_ref()),
            der,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pinned_cert_contains_ip_san() {
        // 证书含 IP SAN 123.249.45.144(= 0x7B 0xF9 0x2D 0x90)
        assert!(PINNED_CERT_DER
            .windows(4)
            .any(|w| w == [0x7B, 0xF9, 0x2D, 0x90]));
        assert_eq!(sha256(PINNED_CERT_DER).len(), 32);
    }
}
