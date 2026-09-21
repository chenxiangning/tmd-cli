//! 桥监听绑定:LAN 接口 IP + 同端口 loopback 双绑。
//! relay_agent 每流转成都对 `127.0.0.1:{port}` 的普通请求/WS 回拨本机桥,而桥只绑
//! LAN 接口 IP(d227f8c 收窄,VPN tun/容器网段不再随 0.0.0.0 全接口可达)——绑在
//! LAN IP 上的 listener 不接受 loopback 拨号,relay 数据面因此整体断。修法:取随机
//! 端口后以同一端口号补绑 127.0.0.1 第二 listener;桥本身落在 loopback 时无需补绑。

use tokio::net::TcpListener;

/// 绑 `lan_ip:0` 随机端口;除桥本身就在 127.0.0.1 外,以同端口号补绑 127.0.0.1。
/// 同端口 loopback 被占(极小概率)时换随机端口重试,三轮不成才报错。
pub(super) async fn bind_bridge(
    lan_ip: &str,
) -> Result<(TcpListener, Option<TcpListener>), String> {
    for _ in 0..3 {
        let lan = TcpListener::bind((lan_ip, 0))
            .await
            .map_err(|e| format!("Web 桥端口绑定失败: {e}"))?;
        let addr = lan
            .local_addr()
            .map_err(|e| format!("Web 桥取端口失败: {e}"))?;
        if addr.ip() == std::net::IpAddr::from([127, 0, 0, 1]) {
            return Ok((lan, None)); // 桥已在 loopback,relay 回拨直达
        }
        match TcpListener::bind((std::net::IpAddr::from([127, 0, 0, 1]), addr.port())).await {
            Ok(lo) => return Ok((lan, Some(lo))),
            Err(_) => continue, // 同端口 loopback 被占,换随机端口重试
        }
    }
    Err("Web 桥 loopback 同端口绑定连续三轮失败".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn single_bind_when_bridge_on_loopback() {
        let (lan, lo) = bind_bridge("127.0.0.1").await.unwrap();
        assert_eq!(lan.local_addr().unwrap().ip().to_string(), "127.0.0.1");
        assert!(lo.is_none());
    }

    /// 拿一个确定可绑的非环回地址:Linux 的 127.0.0.2 天然可绑;macOS 走 UDP 选路。
    fn non_loopback_host() -> Option<String> {
        if std::net::TcpListener::bind("127.0.0.2:0").is_ok() {
            return Some("127.0.0.2".into());
        }
        let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
        s.connect("8.8.8.8:80").ok()?;
        match s.local_addr().ok()?.ip() {
            std::net::IpAddr::V4(v4) if !v4.is_loopback() => Some(v4.to_string()),
            _ => None,
        }
    }

    #[tokio::test]
    async fn dual_bind_same_port_both_dialable() {
        let Some(host) = non_loopback_host() else {
            return; // 无非环回地址可用的环境(极少)跳过
        };
        let (lan, lo) = bind_bridge(&host).await.unwrap();
        let lo = lo.expect("非 127.0.0.1 必须补绑 loopback");
        let lan_port = lan.local_addr().unwrap().port();
        assert_eq!(
            lo.local_addr().unwrap().port(),
            lan_port,
            "同端口才能接住 relay 回拨"
        );
        // 两面都真实可拨(TCP 握手成功即证监听存活)
        tokio::net::TcpStream::connect((host.as_str(), lan_port))
            .await
            .unwrap();
        tokio::net::TcpStream::connect(("127.0.0.1", lan_port))
            .await
            .unwrap();
    }
}
