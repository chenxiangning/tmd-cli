//! ws.rs 直连桥 select 循环的纯辅助(自 ws.rs 拆出,300 行铁则腾位):
//! 事件订阅过滤 + 设备连接的批准态复查/撤销踢两路 tick 包装。

use serde_json::Value;

use super::conn::ConnScope;

/// 事件帧是否该发往本连接:非 event 帧直通;event 帧只发订阅过的。
pub(super) fn event_subscribed(frame: &str, subs: &std::collections::HashSet<String>) -> bool {
    let Ok(v) = serde_json::from_str::<Value>(frame) else {
        return true;
    };
    if v.get("type").and_then(Value::as_str) != Some("event") {
        return true;
    }
    v.get("event")
        .and_then(Value::as_str)
        .is_some_and(|name| subs.contains(name))
}

/// 浏览器连接无复查:永挂;设备连接 5s 一跳(interval 首跳即到 = 连上即查一次)。
pub(super) async fn recheck_tick(scope: &ConnScope, iv: &mut tokio::time::Interval) {
    if let ConnScope::AppDevice { .. } = scope {
        iv.tick().await;
    } else {
        std::future::pending::<()>().await;
    }
}

/// 浏览器连接无踢通道:永挂;设备连接在撤销(revoke → kick)时被唤醒。
pub(super) async fn kick_tick(rx: &mut Option<tokio::sync::watch::Receiver<()>>) {
    match rx {
        Some(r) => {
            let _ = r.changed().await;
        }
        None => std::future::pending::<()>().await,
    }
}
