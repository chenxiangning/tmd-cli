//! 渲染健康诊断事件史(项 15)—— kick/reload/探针/守望击打的全量环形留痕,
//! `render_health_events` 命令回前端只读面板(设置-行为)。下次用户报「假死」
//! 时看全程链路,不必翻日志文件;环形 64 条防内存无界。

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::Serialize;

const CAP: usize = 64;

/// 单条诊断事件(at_ms = 进程内单调墙钟,kind 见 note 调用点)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthEvent {
    pub at_ms: u64,
    pub kind: String,
    pub detail: String,
}

static EVENTS: Mutex<Option<VecDeque<HealthEvent>>> = Mutex::new(None);

/// 追加事件(环形截头);零依赖、各击打点直调。
pub(crate) fn note(kind: &str, detail: String) {
    let Ok(mut g) = EVENTS.lock() else { return };
    let q = match g.as_mut() {
        Some(q) => q,
        None => {
            *g = Some(VecDeque::new());
            g.as_mut().unwrap()
        }
    };
    if q.len() == CAP {
        q.pop_front();
    }
    q.push_back(HealthEvent {
        at_ms: crate::now_millis(),
        kind: kind.to_string(),
        detail,
    });
}

/// 诊断史快照(旧→新);空 = 本运行期零击打。
#[tauri::command]
pub(crate) fn render_health_events() -> Vec<HealthEvent> {
    EVENTS
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|q| q.iter().cloned().collect()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 环形截头保尾() {
        let mut q: VecDeque<HealthEvent> = VecDeque::new();
        for i in 0..(CAP + 10) {
            if q.len() == CAP {
                q.pop_front();
            }
            q.push_back(HealthEvent {
                at_ms: i as u64,
                kind: "t".into(),
                detail: String::new(),
            });
        }
        assert_eq!(q.len(), CAP);
        assert_eq!(q.front().unwrap().at_ms, 10);
        assert_eq!(q.back().unwrap().at_ms, (CAP + 9) as u64);
    }
}
