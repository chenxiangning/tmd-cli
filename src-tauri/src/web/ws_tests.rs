//! ws 单元测试:hello 帧形状(协议字段增删在此钉契约)。

use crate::web::conn::ConnScope;
use crate::web::ws::hello_frame;

#[test]
fn hello_帧携带_lan与host() {
    /* host 存在性与形状由 devices_tests 的 host_id 用例担保,此处只断言帧形状与 lan 透传。 */
    let v = hello_frame(&ConnScope::Browser, "http://192.168.1.6:49598");
    assert_eq!(v["type"], "hello");
    assert!(v["version"].is_string());
    assert_eq!(v["capabilities"], serde_json::json!(["browser"]));
    assert_eq!(v["lan"], "http://192.168.1.6:49598");
    assert!(v["host"].is_string());
}

#[test]
fn lan_过滤律表驱动() {
    use crate::web::server::lan_v4_ok;
    use std::net::Ipv4Addr;
    let yes = |s: &str| lan_v4_ok(s.parse::<Ipv4Addr>().unwrap());
    /* 采信:三段 RFC1918 私网。 */
    for ok in ["192.168.1.6", "10.0.0.5", "172.20.3.9"] {
        assert!(yes(ok), "{ok} 应采信");
    }
    /* 拒绝:回环/公网/ClashX 增强模式假网段/v6 不经此路。 */
    for no in [
        "127.0.0.1",
        "169.254.1.1",
        "8.8.8.8",
        "1.2.3.4",
        "198.18.0.1",
        "198.19.255.9",
    ] {
        assert!(!yes(no), "{no} 应拒绝");
    }
}
