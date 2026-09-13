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
    assert!(listed.iter().find(|m| m.id == "s1").unwrap().workspace_id.is_none());
}
