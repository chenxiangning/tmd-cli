/** en 词典 · approval-inbox 域(键 = 中文源串;zh 恒等无词典)。 */
export const MESSAGES_EN = {
  "审批": "Approvals",
  "审批收件箱 · {n} 个会话在等待 · 应答原样写入会话":
    "Approval inbox · {n} waiting · replies are written to the session verbatim",
  "没有会话在等待确认": "No sessions waiting for confirmation",
  "等待中": "Waiting",
  "等待 {n} 秒": "Waiting {n}s",
  "等待 {n} 分钟": "Waiting {n} min",
  "等待 {n} 小时": "Waiting {n} h",
  "直达": "Open",
  "发送": "Send",
  "应答原样写入会话,回车发送": "Reply is written to the session verbatim; Enter to send",
  "发送失败:会话可能已退出": "Send failed: the session may have exited",
  "聚合等待确认的会话:一键直达与自由文本应答":
    "Aggregates sessions waiting for confirmation: one-click open and free-text replies",
} as Record<string, string>;
