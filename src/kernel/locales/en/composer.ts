/** en 词典 · composer 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  /* view/ComposerToolbar.tsx */
  "点击发送 /model 打开 CLI 模型选择": "Click to send /model and open CLI model picker",
  "对话进行中,本轮结束后可点击切换模型": "Turn in progress — click to switch model after it ends",
  "未识别模型": "Unknown model",
  "模型": "Model",
  "默认模型(尚未读到会话实况)": "Default model (live status not yet observed)",
  "来自 CLI 默认配置,尚未读到会话实况": "From CLI default config — live status not yet observed",
  "默认": "Default",
  "对话进行中,本轮结束后可点击": "Turn in progress — click after it ends",
  "点击打开思考强度选择": "Click to open thinking intensity picker",
  "思考": "Thinking",
  "未识别思考强度": "Unknown thinking level",
  "展开对话框": "Expand input",
  "收起对话框": "Collapse input",
  "命令与技能(⌘K)": "Commands & skills (⌘K)",

  /* view/Composer.tsx */
  "输入消息，⌘/Ctrl+回车发送，回车换行。可用 / 命令 / $ skill / @ 文件引用。拖入文件或 ⌘V 粘贴图片会自动插入引用。":
    "Type a message. ⌘/Ctrl+Enter sends, Enter inserts a newline. Use / commands, $ skills, @ file references. Drop files or ⌘V-paste images to insert references.",
  "输入消息，回车发送，Shift+回车换行。可用 / 命令 / $ skill / @ 文件引用。拖入文件或 ⌘V 粘贴图片会自动插入引用。":
    "Type a message. Enter sends, Shift+Enter inserts a newline. Use / commands, $ skills, @ file references. Drop files or ⌘V-paste images to insert references.",
  "释放以附加文件 / 图片": "Release to attach files / images",

  /* view/CommandDrawer.tsx */
  "已发送到幕布:{wire}": "Sent to terminal: {wire}",
  "已打开:{name}": "Opened: {name}",
  "命令与技能面板": "Commands & skills panel",
  "分区切换": "Section tabs",
  "关闭 (Esc)": "Close (Esc)",
  "关闭": "Close",
  "全部": "All",
  "{n} 项": "{n} items",

  /* view/DrawerItemList.tsx + drawerSections.ts (consumed at call sites) */
  "暂无命令或技能": "No commands or skills yet",
  "⚡ 直接发送到幕布": "⚡ Send to terminal",
  "↵ 插入输入框": "↵ Insert into input",
  "⇱ 打开面板": "⇱ Open panel",
  "命令": "Commands",
  "技能": "Skills",
  "MCP": "MCP",
  "插件": "Plugins",
  "⚡ 直接发送": "⚡ Send",
  "↵ 插入": "↵ Insert",
  "⇱ 打开": "⇱ Open",
  "直接发送到幕布": "Send to terminal",
  "插入输入框继续编辑": "Insert into input to keep editing",
  "打开对应面板": "Open the panel",

  /* view/SuggestionList.tsx */
  "文件": "Files",

  /* view/AttachmentStrip.tsx */
  "附件": "Attachments",
  "移除": "Remove",
  "已附加 {n} 个文件 · 拖拽可重排": "{n} files attached · drag to reorder",
  "全部清除 ×": "Clear all ×",

  /* view/AnchorRail.tsx */
  "消息锚点": "Message anchors",

  /* view/QuotaChip.tsx */
  "{id} 额度": "{id} quota",
  "已使用": "Used",
  "暂不支持额度查询": "Quota lookup not supported",
  "下次刷新: {abs} · {rel}": "Next refresh: {abs} · {rel}",
  "余额: {amount}": "Balance: {amount}",
  "更新于 {time}": "Updated at {time}",
  "尚未加载": "Not loaded yet",
  "重新抓取额度": "Refetch quota",
  "刷新": "Refresh",
  "点击查看额度详情": "Click to view quota details",
  "{title},点击查看详情": "{title}, click for details",
  "额度": "Quota",

  /* index.ts (plugin meta + command titles) */
  "输入区": "Composer",
  "Composer:富文本输入、附件、建议": "Composer: rich input, attachments, suggestions",
  "打开/关闭命令抽屉": "Open / close command drawer",
  "发送消息": "Send message",
  "切换输入区高度段": "Toggle input area height",

  /* drawerItems.ts pluginDrawerCommands() */
  "打开 {name}": "Open {name}",

  /* triggers/suggest.ts */
  "目录": "Folder",
} as Record<string, string>;