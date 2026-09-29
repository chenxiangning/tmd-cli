/** en 词典 · approval-inbox 域(键 = 中文源串;zh 恒等无词典)。 */
export const MESSAGES_EN = {
  "审批": "Approvals",
  "没有会话在等待确认": "No sessions waiting for confirmation",
  "等待中": "Waiting",
  "等待 {n} 秒": "Waiting {n}s",
  "等待 {n} 分钟": "Waiting {n} min",
  "等待 {n} 小时": "Waiting {n} h",
  "直达": "Open",
  "历史提问(落盘,最近 {n} 条)": "Ask history (persisted, last {n})",
  "{n} 问": "{n} questions",
  "发送": "Send",
  "应答原样写入会话,回车发送": "Reply is written to the session verbatim; Enter to send",
  "应答发送失败,会话可能已退出": "Reply failed to send; the session may have exited",
  "审批收件箱 · {n} 个会话在等待 · 摘录以会话面板为准":
    "Approval inbox · {n} waiting · excerpts are hints; the session panel is authoritative",
  "摘录以会话面板为准": "Excerpt hint — the session panel is authoritative",
  "{n} 个问题": "{n} questions",
  "切到「{name}」(⇥ 跳题)": "Switch to \"{name}\" (Tab to jump)",
  "提交全部答案(⇥ 到 Submit + 回车)": "Submit all answers (Tab to Submit + Enter)",
  "选择该项并推进(↑/↓ + {key});若在幕布手动动过光标,以幕布为准":
    "Pick this option and advance (arrows + {key}); if you moved the cursor in the terminal, the terminal is authoritative",
  "空格勾选": "Space to toggle",
  "允许/拒绝请按该 CLI 自己的键位:「直达」进幕布操作;这里只代发文本":
    "Allow/deny uses this CLI's own keys: hit \"Open\" to act in the terminal; replies here only send text",
  "点击关闭": "Click to dismiss",
  "审批收件箱": "Approval Inbox",
  "聚合等待确认的会话:一键直达与自由文本应答":
    "Aggregates sessions waiting for confirmation: one-click open and free-text replies",
} as Record<string, string>;
