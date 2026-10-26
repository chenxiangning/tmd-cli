//! 渲染健康诊断事件史(项 15)—— kick/reload/探针/守望击打的全量留痕,
//! `render_health_events` 命令回前端只读面板(设置-行为)。下次用户报「假死」
//! 时看全程链路,不必翻日志文件。容量 = 头部 8 条(首 8 条永不挤出,保住
//! 起病点)+ 环形 64 条(只挤环形最老一条),防内存无界。

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

const CAP: usize = 64;
/// 头部保留条数:首若干条是「起病点」,容量满后只挤环形尾,头部不挤出。
const HEAD: usize = 8;

/// 单条诊断事件(at_ms = 进程运行期 epoch 毫秒(墙钟),kind 见 note 调用点)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthEvent {
    pub at_ms: u64,
    pub kind: String,
    pub detail: String,
}

static EVENTS: Mutex<VecDeque<HealthEvent>> = Mutex::new(VecDeque::new());

/// 追加事件(容量满 = 头 8 + 环 64 时挤下标 HEAD 处,即环形最老一条);
/// 零依赖、各击打点直调。
pub(crate) fn note(kind: &str, detail: String) {
    let Ok(mut q) = EVENTS.lock() else { return };
    if q.len() == HEAD + CAP {
        q.remove(HEAD);
    }
    q.push_back(HealthEvent {
        at_ms: crate::now_millis(),
        kind: kind.to_string(),
        detail,
    });
}

/// 诊断史快照(旧→新,头部自然在前);空 = 本运行期零击打。
#[tauri::command]
pub(crate) fn render_health_events() -> Vec<HealthEvent> {
    EVENTS
        .lock()
        .map(|q| q.iter().cloned().collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /* 全局 EVENTS 单实例:契约测试并进单函数,避免并发互踩。 */
    #[test]
    fn 契约_头部保留与环形截尾() {
        let total = HEAD + CAP + 5;
        for i in 0..total {
            note("t", format!("{i}"));
        }
        let events = render_health_events();
        assert_eq!(events.len(), HEAD + CAP);
        /* 首 8 条(起病点)仍在最前 */
        for (i, e) in events.iter().take(HEAD).enumerate() {
            assert_eq!(e.detail, format!("{i}"));
        }
        /* 环形尾最老一条 = 第 HEAD+5 条(中间 5 条被挤出),最新 = 末条 */
        assert_eq!(events[HEAD].detail, format!("{}", HEAD + 5));
        assert_eq!(events.last().unwrap().detail, format!("{}", total - 1));
    }
}
