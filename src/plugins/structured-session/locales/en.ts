/** structured-session 英文词典。 */
export const MESSAGES_EN: Record<string, string> = {
  "结构化": "Structured",
  "结构化会话": "Structured session",
  "该引擎不支持结构化会话": "This engine has no structured-session support",
  "启动 RPC 会话中…": "Starting RPC session…",
  "启动失败": "Start failed",
  "重试": "Retry",
  "会话已结束(关闭此 tab 可再开)": "Session ended (close this tab to start again)",
  "重新开启": "Restart",
  "发消息(Enter 发送,Shift+Enter 换行)": "Send a message (Enter to send, Shift+Enter for newline)",
  "会话未就绪": "Session not ready",
  "发送": "Send",
  "中止": "Abort",
  "working for": "working for ",
  "思考中…": "Thinking…",
  "生成中": "Generating",
  "空闲": "Idle",
  "等待确认": "Awaiting confirmation",
  "批准": "Approve",
  "拒绝": "Deny",
  /* 极简联动键(sessionTab 与 session-viewer 同措辞;插件域自带一份防依赖注册序) */
  "极简": "Minimal",
  "极简展示:每轮工作过程折叠为一行,只保留最终答复":
  "Minimal view: each turn's work collapses to one row, keeping only the final reply",
  /* 非 confirm 部件自动取消 notice(消费点在 cli-shared/piRpc,feature 插件带词典先例) */
  "CLI 发起 {kind} 交互,已按协议自动取消":
  "CLI requested a {kind} interaction; auto-cancelled per protocol",
  /* chrome 装饰类部件聚合行(明细括注与时刻由 piRpcReducer 拼接,协议词不译) */
  "TUI 部件交互已自动取消 ×{count}":
  "{count} TUI widget interactions auto-cancelled",
  /* header 菜单(ssHeader:引擎切换 / 模型与思考级) */
  "模型与思考级": "Model & thinking level",
  "筛选模型…": "Filter models…",
  "载入模型清单…": "Loading models…",
  "模型清单不可用": "Model list unavailable",
  "无匹配模型": "No matching model",
  "思考级": "Thinking level",
  "切换引擎(另开 tab,当前会话保留)": "Switch engine (opens a new tab; this session stays)",
  "切换引擎": "Switch engine",
  "当前": "Current",
  "模型": "Model",
  /* 批次2:busy 排队发送 */
  "输入下一问(排队,当前轮结束自动发送)": "Type the next question (queued; sends when this turn ends)",
  "排队 {n}": "Queued {n}",
  "当前轮结束后自动发送": "Sends automatically when the current turn ends",
  /* 批次3:断线接续 */
  "接续重开": "Resume session",
}
