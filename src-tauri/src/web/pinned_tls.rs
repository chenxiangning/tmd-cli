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

#[derive(Debug)]
struct PinnedVerifier {
    default: Arc<WebPkiServerVerifier>,
    pinned_hash: Vec<u8>,
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
        let is_pinned_host = match server_name {
            ServerName::IpAddress(ip) => std::net::IpAddr::from(*ip).to_string() == PINNED_HOST,
            _ => false,
        };
        if is_pinned_host {
            // 指纹一致即信任(自签无链可走);握手签名校验仍委托默认 verifier。
            if sha256(end_entity.as_ref()) == self.pinned_hash {
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

/// 拨号用 ClientConfig:公共 CA 默认链 + 对 PINNED_HOST 的证书钉住。
pub fn pinned_client_config() -> Arc<rustls::ClientConfig> {
    let mut roots = RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let default = WebPkiServerVerifier::builder(Arc::new(roots))
        .build()
        .expect("webpki verifier");
    let mut cfg = rustls::ClientConfig::builder()
        // 占位根(同库);实际校验整体替换为 PinnedVerifier。
        .with_root_certificates({
            let mut r = RootCertStore::empty();
            r.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            r
        })
        .with_no_client_auth();
    cfg.dangerous()
        .set_certificate_verifier(Arc::new(PinnedVerifier {
            default,
            pinned_hash: sha256(PINNED_CERT_DER),
        }));
    Arc::new(cfg)
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
