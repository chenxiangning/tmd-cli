//! 事件单源 —— Rust 侧所有「发往前端的事件」经此一处扇出:
//! 桌面 webview(Tauri emit)与 Web 远程访问桥(web/ 模块的 WS 广播)同时收到,
//! 同一份 React 前端跑在两个表面对事件来源零感知。
//!
//! ponytail: 不做 32ms 合帧批量 —— pty_spawn 的 OUT_AGGREGATE_WINDOW 已把
//! PTY 字节聚成 chunk 级事件,WS 逐帧转发量级可控;手机端实测卡顿再加。

use serde::Serialize;
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

/// Web 桥事件帧积压上限:PTY 高频流下 WS 消费滞后时允许缓冲的帧数,
/// 超出则慢消费者收 Lagged 跳帧(幕布宁可跳帧,不可反向阻塞桌面 emit 路径)。
const EVENT_CHANNEL_CAPACITY: usize = 512;

/// 广播 channel:Web 桥每条 WS socket 经 subscribe() 取一个 receiver;
/// emit 点只持 &AppHandle,经此全局取广播端,不必把 bus 穿进每个调用栈。
static BUS: LazyLock<broadcast::Sender<String>> =
    LazyLock::new(|| broadcast::channel(EVENT_CHANNEL_CAPACITY).0);

/// Web 桥订阅:每条 WS socket 一个 receiver。
pub(crate) fn subscribe() -> broadcast::Receiver<String> {
    BUS.subscribe()
}

/// 桌面 webview 与 Web 桥同时投递;返回 webview 侧是否送达
/// (pty_spawn 以其为「前端已销毁」的泵退出信号,语义与直调 app.emit 一致)。
pub(crate) fn emit<T: Serialize>(app: &AppHandle, name: &str, payload: &T) -> bool {
    let delivered = app.emit(name, payload).is_ok();
    if BUS.receiver_count() > 0 {
        let frame = serde_json::json!({
            "type": "event",
            "event": name,
            "payload": payload,
        });
        /* send 失败 = 积压溢满(慢消费者跳帧),不拖累桌面。 */
        let _ = BUS.send(frame.to_string());
    }
    delivered
}
