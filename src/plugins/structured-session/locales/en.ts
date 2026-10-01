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
}
