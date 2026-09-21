//! devices 单元测试:注册表生命周期/配对码/节流/hostId/落盘权限。
use crate::web::devices::*;

fn tmpdir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("tmd-dev-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn 配对全链_铸码_待批_批准_验证() {
    let dir = tmpdir("full");
    let reg = DeviceRegistry::default();
    let (code, exp) = reg.mint_code(1000);
    assert_eq!(exp, 1000 + PAIR_TTL_SECS);
    assert_eq!(code.len(), 9, "XXXX-XXXX");

    let (device_id, token) = reg.pair(&dir, &code, "大仙的 iPhone", 1001).unwrap();
    // pending 未批准:凭据命中但 approved=false(ws 分流层据此发 4001/pending)
    assert!(
        !find_by_credentials(&dir, &device_id, &token)
            .unwrap()
            .approved
    );
    // 批准后通过,且返回设备行
    assert!(approve(&dir, &device_id, 1002));
    let dev = find_by_credentials(&dir, &device_id, &token).unwrap();
    assert_eq!(dev.name, "大仙的 iPhone");
    assert!(dev.approved);
    // 落盘无明文 token(展示名允许明文)
    let raw = std::fs::read_to_string(devices_path(&dir)).unwrap();
    assert!(!raw.contains(&token));
}

#[test]
fn 配对码_错码_过期_单次消费() {
    let dir = tmpdir("code");
    let reg = DeviceRegistry::default();
    let (code, _) = reg.mint_code(1000);
    assert_eq!(
        reg.consume_code("WRONG-CODE", 1001),
        Err(PairError::BadCode)
    );
    assert_eq!(
        reg.consume_code(&code, 1000 + PAIR_TTL_SECS + 1),
        Err(PairError::Expired)
    );
    // 过期已清,原码再试 = 错码
    assert_eq!(reg.consume_code(&code, 1002), Err(PairError::BadCode));
    // 单次:pair 成功后同码再 pair 拒
    let (c, _) = reg.mint_code(2000);
    let _ = reg.pair(&dir, &c, "a", 2001).unwrap();
    assert_eq!(reg.pair(&dir, &c, "b", 2002), Err(PairError::BadCode));
}

#[test]
fn 撤销后验证拒() {
    let dir = tmpdir("revoke");
    let reg = DeviceRegistry::default();
    let (code, _) = reg.mint_code(1000);
    let (device_id, token) = reg.pair(&dir, &code, "pad", 1001).unwrap();
    assert!(approve(&dir, &device_id, 1002));
    assert!(find_by_credentials(&dir, &device_id, &token).is_some());
    assert!(revoke(&dir, &device_id));
    assert!(
        find_by_credentials(&dir, &device_id, &token).is_none(),
        "撤销删行后凭据不命中"
    );
    assert!(!revoke(&dir, &device_id), "重复撤销返回 false");
}

#[test]
fn 错_token_拒() {
    let dir = tmpdir("badtok");
    let reg = DeviceRegistry::default();
    let (code, _) = reg.mint_code(1000);
    let (device_id, token) = reg.pair(&dir, &code, "dev", 1001).unwrap();
    approve(&dir, &device_id, 1002);
    assert!(find_by_credentials(&dir, &device_id, &format!("{token}x")).is_none());
    assert!(find_by_credentials(&dir, "no-such-device", &token).is_none());
}

#[test]
fn host_id_稳定且形状正确() {
    let dir = tmpdir("hostid");
    let a = host_id(&dir);
    let b = host_id(&dir);
    assert_eq!(a, b, "一次性生成,重读不变");
    assert_eq!(a.len(), 32);
    assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
}

#[cfg(unix)]
#[test]
fn 落盘权限_仅属主() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tmpdir("perm");
    let reg = DeviceRegistry::default();
    let (code, _) = reg.mint_code(1000);
    let _ = reg.pair(&dir, &code, "dev", 1001).unwrap();
    let mode = std::fs::metadata(devices_path(&dir))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o077, 0, "web_devices.json 必须 0600");
}

#[test]
fn 名字收紧() {
    assert_eq!(sanitize_name("  pad  "), "pad");
    assert_eq!(sanitize_name(""), "iPhone");
    assert_eq!(sanitize_name("x".repeat(80).as_str()).chars().count(), 40);
}

#[test]
fn 节流_连续失败到上限拒_成功清零() {
    let reg = DeviceRegistry::default();
    for i in 1..=PAIR_FAIL_LIMIT {
        assert!(!reg.pair_denied("1.2.3.4"));
        assert_eq!(reg.note_fail("1.2.3.4"), i);
    }
    assert!(reg.pair_denied("1.2.3.4"));
    reg.note_ok("1.2.3.4");
    assert!(!reg.pair_denied("1.2.3.4"));
}

#[test]
fn 撤销即时踢_活跃连接收到信号() {
    use crate::web::conn::register_live;
    let dir = tmpdir("kick");
    let reg = DeviceRegistry::default();
    let (code, _) = reg.mint_code(1000);
    let (device_id, _token) = reg.pair(&dir, &code, "dev", 1001).unwrap();
    approve(&dir, &device_id, 1002);
    let (_guard, rx) = register_live(&device_id);
    assert!(!rx.has_changed().unwrap(), "未撤销不应有信号");
    assert!(revoke(&dir, &device_id));
    assert!(rx.has_changed().unwrap(), "撤销必须即时置位踢信号");
}
