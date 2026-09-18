/** en 词典 · marks 域(键 = 中文源串;zh 恒等无词典)。 */
export const MESSAGES_EN = {
  "文件标记": "File Marks",
  "标记": "Marks",
  "文件阅读标记:行间锚点、跨文件汇总,发送自动带引用,终端回链定位":
    "File reading marks: inline anchors, cross-file digest, quotes injected on send, terminal backlinks",
  /* 状态 */
  "待发送": "Pending",
  "已入对话": "Staged",
  "已发送": "Sent",
  "漂移已重定位": "Relocated",
  "失联": "Lost",
  /* 行内卡 / 面板 */
  "点此添加标注": "Click to add a note",
  "写标注,随引用发送到对话…": "Write a note to send with the quote…",
  "写标注,下次发送自动带上…": "Write a note, included with the next send…",
  "⚑ 发送到对话": "⚑ Send to chat",
  "↩ 撤回": "↩ Unstage",
  "↩ 重发": "↩ Resend",
  "收起 ▴": "Collapse ▴",
  "收起": "Collapse",
  "备注": "Note",
  "移除": "Remove",
  "⚑ 标记": "⚑ Mark",
  "定位到标记": "Reveal mark",
  "删除标记": "Delete mark",
  "打开文件": "Open file",
  "发送本文件": "Send this file",
  "在文件里选中行,点「⚑ 标记」落锚;标记在此跨文件汇总。":
    "Select lines in a file and click “⚑ Mark” to anchor; marks are aggregated here across files.",
  /* 面板头 */
  "{n} 处标记 · {m} 个文件": "{n} marks · {m} files",
  "待发送 {n}": "{n} pending",
  "⚑ 发送全部 ({n})": "⚑ Send all ({n})",
  /* 芯片条 */
  "标记引用": "Marked quotes",
  "撤回引用(回到待发送)": "Unstage quote (back to pending)",
  /* 预览交互卡 */
  "移除标记": "Remove mark",
} as Record<string, string>;
