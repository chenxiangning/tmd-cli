//! SessionRegistry 契约测试(本文件由 session.rs 尾部 mod 挂载)。

use super::{SessionMeta, SessionRegistry};

fn meta(id: &str) -> SessionMeta {
    SessionMeta {
        id: id.to_string(),
        profile_id: "omp".to_string(),
        cwd: "/w".to_string(),
        workspace_id: None,
        created_at: 0,
        pid: None,
        kind: "cli".to_string(),
        title: None,
        engine: None,
        cli_session_id: None,
    }
}

#[test]
fn set_workspace_updates_registered_and_rejects_missing() {
    let reg = SessionRegistry::default();
    reg.register(meta("s1"));
    assert!(reg.set_workspace("s1", Some("ws-7".to_string())));
    let listed = reg.list();
    let updated = listed.iter().find(|m| m.id == "s1").expect("registered");
    assert_eq!(updated.workspace_id.as_deref(), Some("ws-7"));
    /* 未注册会话:Err 上抛由命令层转 String,这里只验 false */
    assert!(!reg.set_workspace("ghost", None));
    /* 清空归属(None)也应可写:接管失败回滚语义 */
    assert!(reg.set_workspace("s1", None));
    let listed = reg.list();
    assert!(listed
        .iter()
        .find(|m| m.id == "s1")
        .unwrap()
        .workspace_id
        .is_none());
}

#[test]
fn set_cli_session_id_updates_and_locks_wire_shape() {
    let reg = SessionRegistry::default();
    reg.register(meta("s1"));
    assert!(reg.set_cli_session_id("s1", Some("cli-9".to_string())));
    let listed = reg.list();
    let m = listed.iter().find(|x| x.id == "s1").expect("registered");
    assert_eq!(m.cli_session_id.as_deref(), Some("cli-9"));
    assert!(!reg.set_cli_session_id("ghost", Some("x".to_string())));
    /* 线上形状:手机 session_list 按 camelCase 直读(白屏事故锁) */
    let v = serde_json::to_value(m).expect("serialize");
    assert_eq!(
        v.get("cliSessionId").and_then(|s| s.as_str()),
        Some("cli-9")
    );
}

/// 线上形状锁:session_list 载荷为 serde camelCase(手机壳 UI 按此消费)。
/// 2026-09-23 白屏根因:手机端误按 snake_case 解析,profileId 全 undefined
/// → 渲染崩溃。此测试锁死字段名,防止序列化形状再漂移。
#[test]
fn session_meta_线上形状_camel_case() {
    let v = serde_json::to_value(meta("s1")).expect("serialize");
    assert!(v.get("profileId").is_some(), "profileId 必须是 camelCase");
    assert!(
        v.get("workspaceId").is_some(),
        "workspaceId 必须是 camelCase"
    );
    assert!(v.get("createdAt").is_some(), "createdAt 必须是 camelCase");
    assert!(v.get("profile_id").is_none(), "不允许 snake_case 漏出");
}
