/** structured-session 英文词典。 */
export const MESSAGES_EN: Record<string, string> = {
  "带渲染的会话": "Rendered session",
  "结构化会话": "Structured session",
  "该引擎不支持 RPC 会话": "This engine does not support RPC sessions",
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
  /* 打磨轮:用量 + 命令补全 */
  "上下文占用 {p}%,本轮会话累计 {n} tokens": "Context {p}% used, {n} tokens this session",
  "载入命令目录…": "Loading command catalog…",
  "无匹配命令": "No matching commands",
  /* 0.4.8:共同存证 / 接力 / 上一回合预览重试 */
  "批次": "Batch",
  "批次 #{index}": "Batch #{index}",
  "接力": "Relay",
  "重试上一回合…": "Retry previous turn…",
  "重试上一回合": "Retry previous turn",
  "目标会话:{title}": "Target session: {title}",
  "仅回填，不会自动发送": "Only fills the composer; nothing is sent automatically",
  "回填输入框": "Fill composer",
  "对应 checkpoint 批次": "Corresponding checkpoint batch",
  /* RPC 输入面外观对齐 PTY composer(2026-11-05):唤醒轨与发送 */
  "@ 引用文件": "@ Reference file",
  "$ 调用技能": "$ Invoke skill",
  /* 工具行类型 chip(codemoss ProcessDisclosure 分类;「命令」键与 kernel 撞,
     消歧为「命令工具」) */
  "搜索": "Search",
  "命令工具": "Command",
  "读取": "Read",
  "编辑": "Edit",
  "查找": "Find",
  "子任务": "Subtask",
  "工具": "Tool",
  /* 长消息折叠(codemoss CollapsibleMessage 交互律;展开/收起复用 kernel 键) */
  "回到底部": "Back to bottom",
  /* 过程折叠组头摘要(codemoss ProcessDisclosure;「工具调用 {n} 次」复用 kernel 词典) */
  "思考 {n} 次": "Thought {n} times",
  /* 过程展开区(codemoss ThinkingSurface 题头 / 唤醒轨智能体与提示词) */
  "思考过程": "Thinking process",
  "智能体(##)": "Agents (##)",
  "提示词(!!)": "Prompts (!!)",
  /* 用户块图片内联(与 session-viewer 同译) */
  "切换图片大小": "Toggle image size",
  /* 对话框拖拽柄 */
  "拖拽调整高度": "Drag to resize",
  /* 幕布宽度抓手(2026-11-05) */
  "调整幕布宽度": "Adjust canvas width",
}
