//! 设备域(AppDevice)额度查询专用白名单通道 —— 自 quota.rs 拆出(文件规模铁则)。
//! 共享体(fetch_with/reqwest_client/请求响应类型)在父模块;本文件只持白名单与收口律。

use super::{fetch_with, QuotaRequest, QuotaResponse};

/// 设备域额度查询专用代理(2026-10-06):quota_fetch 是任意 URL+方法的出站
/// HTTP 原语,对已配对设备即 SSRF 面,AppDevice 域不授(conn.rs);手机端额度
/// 链改走本命令。放行两轴,URL 拼装仍在 TS(cli-shared fetcher 单一真相):
/// 1) 固定厂商配额端点 host(额度 fetcher 全集,任意 path);
/// 2) 用户自建中转/relay:https + DNS 域名 + 解析结果非私网/回环。
///
/// 强制 GET、丢弃 body;重定向仅当目标 host 同过本白名单才跟随。
const VENDOR_QUOTA_HOSTS: &[&str] = &[
    "api.kimi.com",
    "api.minimaxi.com",
    "api.minimax.io",
    "open.bigmodel.cn",
    "api.z.ai",
    "api.deepseek.com",
    "chatgpt.com",
];

fn ip_reachable(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            !v4.is_private() && !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            /* IPv4-mapped(::ffff:10.0.0.1)按 V4 同律判(std parse 落 V6 分支,
             * 二轮评审 2026-10-06:原先三谓词全 false 直接放行)。 */
            if let Some(v4) = v6.to_ipv4_mapped() {
                return !v4.is_private()
                    && !v4.is_loopback()
                    && !v4.is_link_local()
                    && !v4.is_unspecified();
            }
            !v6.is_loopback()
                && !v6.is_unspecified()
                && !v6.is_unique_local()   /* fd00::/8 内网 */
                && {
                    /* fe80::/10 链路本地:std 无稳定 is_link_local(V6),按位判。 */
                    let b = v6.octets();
                    !(b[0] == 0xfe && (b[1] & 0xc0) == 0x80)
                }
        }
    }
}

fn host_reachable_only(host: &str) -> bool {
    /* IP 直连(含回环/私网字面量)一律拒;DNS 名走解析复核。
     * url::host_str 的 v6 形态带方括号("[::1]"),先剥再判。 */
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    bare.parse::<std::net::IpAddr>()
        .map(ip_reachable)
        .unwrap_or(true)
}

fn vendor_url_allowed(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else {
        return false;
    };
    if u.scheme() != "https" {
        return false;
    }
    let Some(host) = u.host_str() else {
        return false;
    };
    VENDOR_QUOTA_HOSTS.contains(&host) || host_reachable_only(host)
}

/// 重定向目标 host 的同步 DNS 复核(与首跳 lookup 同律,全部解析结果可达才跟随;
/// 解析失败 = 拒)。reqwest 策略回调非 async,用 std 阻塞解析。
fn redirect_dns_ok(host: &str) -> bool {
    use std::net::ToSocketAddrs;
    (host, 443u16)
        .to_socket_addrs()
        .map(|addrs| addrs.map(|a| a.ip()).all(ip_reachable))
        .unwrap_or(false)
}

async fn reqwest_client(policy: reqwest::redirect::Policy) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(policy)
        .build()
        .map_err(|e| format!("http client build: {e}"))
}

#[tauri::command]
pub async fn quota_vendor_fetch(spec: QuotaRequest) -> Result<QuotaResponse, String> {
    if !vendor_url_allowed(&spec.url) {
        return Err(format!("vendor quota url 不在白名单: {}", spec.url));
    }
    /* relay 分支 DNS 复核:域名解析到私网/回环 = 内网 pivot,拒绝。 */
    if let Ok(u) = url::Url::parse(&spec.url) {
        let host = u.host_str().unwrap_or("");
        if !VENDOR_QUOTA_HOSTS.contains(&host) {
            match tokio::net::lookup_host((
                host.to_string(),
                u.port_or_known_default().unwrap_or(443),
            ))
            .await
            {
                Ok(addrs) => {
                    /* any 解析到内网即拒(二轮评审 2026-10-06:原 all-内网才拒,
                     * 双答 DNS {公网,10.x} 可过闸);复核后 reqwest 二次解析的
                     * rebinding 时间窗(完整防御需连接层钉 IP)留观。 */
                    if addrs.map(|a| a.ip()).any(|ip| !ip_reachable(ip)) {
                        return Err(format!("vendor quota host 解析到内网地址: {host}"));
                    }
                }
                Err(e) => return Err(format!("vendor quota host 解析失败: {e}")),
            }
        }
    }
    /* 重定向目标同律 DNS 复核(二轮评审 2026-10-06):reqwest 回调是同步上下文,
     * 阻塞解析毫秒级(额度 120s 低频);非厂商 host 解析含内网/解析失败 = 不跟随。 */
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 || !vendor_url_allowed(attempt.url().as_str()) {
            return attempt.error("redirect target 不在厂商额度白名单");
        }
        let host = attempt.url().host_str().unwrap_or("");
        if !VENDOR_QUOTA_HOSTS.contains(&host) && !redirect_dns_ok(host) {
            return attempt.error("redirect target 解析到内网地址");
        }
        attempt.follow()
    });
    let client = reqwest_client(policy).await?;
    /* 设备域只读:强制 GET,忽略 method/body(额度 fetcher 全集本就 GET)。 */
    fetch_with(
        client,
        QuotaRequest {
            method: None,
            body: None,
            ..spec
        },
    )
    .await
}

#[cfg(test)]
mod vendor_tests {
    use super::vendor_url_allowed;

    #[test]
    fn 厂商白名单与内网拒绝矩阵() {
        for ok in [
            "https://api.kimi.com/coding/v1/usages",
            "https://chatgpt.com/backend-api/wham/usage",
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
            "https://api.z.ai/api/monitor/usage/quota/limit",
            "https://my-relay.example.com/api/user/self",
        ] {
            assert!(vendor_url_allowed(ok), "{ok} 应放行");
        }
        for no in [
            "http://api.kimi.com/coding/v1/usages",     // 明文 http 一律拒
            "https://192.168.1.6:49598/api/user/self",  // 私网 IP 直连
            "https://127.0.0.1:8080/x",                 // 回环
            "https://[fd00::1]:8080/x",                 // v6 ULA 内网(二轮)
            "https://[fe80::1]:8080/x",                 // v6 链路本地(二轮)
            "https://[::ffff:10.0.0.5]:8080/x",         // v4-mapped 私网(二轮)
            "https://10.0.0.5/api/user/self",           // 10/8
            "https://169.254.169.254/latest/meta-data", // 云元数据 SSRF
            "file:///etc/passwd",                       // 非 https scheme
            "not a url",
        ] {
            assert!(!vendor_url_allowed(no), "{no} 应拒绝");
        }
        /* relay 轴 = 任意 https DNS 域名(用户自建中转不可枚举;IP 直连已拒,
         * 公网 DNS 名与 session_spawn 的 SSH 级信任同律,不再收紧)。 */
        assert!(vendor_url_allowed(
            "https://random-host.example.org/api/user/self"
        ));
    }

    #[test]
    fn 重定向_dns_复核_内网与不可解析拒() {
        /* IP 字面量直判零 DNS(环境无关,CI 不抖);域名形态复核与首跳 lookup
         * 同源,由白名单矩阵的句法面覆盖,不在单测里依赖真实解析。 */
        assert!(super::redirect_dns_ok("1.1.1.1"));
        assert!(!super::redirect_dns_ok("127.0.0.1"));
        assert!(!super::redirect_dns_ok("192.168.1.6"));
    }
}
