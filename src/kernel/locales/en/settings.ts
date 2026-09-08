/** en 词典 · settings 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
export const MESSAGES = {
  // AppearanceSystemCard
  "语言": "Language",
  "界面文案语言;切换立即生效(整个界面重新加载,会话与数据不受影响)。":
    "UI text language; switching applies immediately (the whole UI reloads; sessions and data are unaffected).",
  "界面缩放": "UI zoom",
  "整个界面等比缩放(80%–150%);终端文字大小另由下方字号单独控制。":
    "Scales the whole UI proportionally (80%–150%); terminal text size is controlled separately below.",
  "界面字号": "UI font size",
  "全客户端文字与图标大小(12–20 px);布局宽度不变,即时生效。":
    "Text and icon size across the whole client (12–20 px); layout widths stay put, applies instantly.",
  "重置": "Reset",
  "终端字号": "Terminal font size",
  "幕布终端文字大小(10–20 px),拖动即时生效。":
    "Terminal text size (10–20 px); changes apply as you drag.",
  "终端字体": "Terminal font",
  "等宽字体;未安装的字体置灰,可选「自定义」填 CSS family。":
    "Monospace fonts; unavailable fonts are grayed out — choose “Custom” to enter a CSS family.",
  "平台默认": "Platform default",
  "未安装": "not installed",
  "自定义…": "Custom…",
  "自定义字体": "Custom font",
  "CSS font-family 串,如 'JetBrains Mono', 'Courier New'。":
    "CSS font-family string, e.g. 'JetBrains Mono', 'Courier New'.",

  // BasicAppearanceTab
  "跟随系统": "Follow system",
  "浅色": "Light",
  "深色": "Dark",
  "自定义": "Custom",
  "当前跟随系统使用 {appearance} 外观。": "Currently following the system's {appearance} appearance.",
  "当前使用自定义主题({preset},{appearance})。": "Using custom theme ({preset}, {appearance}).",
  "当前固定使用 {appearance} 外观。": "Fixed to {appearance} appearance.",
  "会话标题 tab 条": "Session title tabs",
  "顶栏中央展示已打开的会话，点击切换；关闭后仍可从左侧栏进入会话。":
    "Show open sessions in the center of the title bar; click to switch. Closed sessions remain reachable from the left sidebar.",
  "会话标题 tab 条容量": "Session tab capacity",
  "开启": "On",
  "关闭": "Off",
  "主题": "Theme",
  "浅色主题": "Light themes",
  "深色主题": "Dark themes",

  // BehaviorTab
  "Enter 发送": "Enter to send",
  "⌘/Ctrl+Enter 发送": "⌘/Ctrl+Enter to send",
  "发送快捷键": "Send shortcut",
  "选择消息发送与换行的按键行为。": "Choose which key sends messages and which inserts a newline.",
  "会话输出缓冲上限": "Session output buffer limit",
  "单会话保留的终端输出字符数（5万–1000万，默认 50 万）。切回会话的回放深度由它决定；更早历史可在幕布顶部继续翻页加载。":
    "Characters of terminal output kept per session (50k–10M, default 500k). It sets the replay depth when switching back; older history can still be paged in at the top of the terminal.",
  "Ask 提示音": "Ask notification sound",
  "CLI 弹出提问/权限确认面板时播放提示音，离开屏幕也能第一时间知道。":
    "Plays a sound when a CLI shows an ask/permission panel, so you notice right away even while away.",
  "提示音": "Notification sound",
  "选择 Ask 提示音音效，「试听」立即播放。": "Choose the ask sound; “Preview” plays it immediately.",
  "提示音音效": "Notification sound effect",
  "试听": "Preview",
  "结束提示音": "Turn-end sound",
  "一轮对话结束且未被查看时播放（结算后静默 3 秒确认，中途来新输出不响）。":
    "Plays when a turn ends unseen (confirmed after 3 silent seconds; it stays silent if new output arrives meanwhile).",
  "结束音效": "Turn-end sound effect",
  "选择轮次结束提示音音效，「试听」立即播放。": "Choose the turn-end sound; “Preview” plays it immediately.",
  "后台提醒": "Background notifications",
  "窗口失焦时，当前会话完成一轮对话也标记未读并播放结束提示音；切回窗口即恢复已读。":
    "While the window is unfocused, a finished turn still marks the session unread and plays the turn-end sound; focusing the window clears it.",
  "启动时自动激活会话": "Auto-activate sessions on startup",
  "重新打开应用时，后台预激活最近 N 天内有活动的会话（0 = 关闭）。预激活的会话点开即达，无需等待启动；每个会话都是一个真实进程，请配合上限使用。":
    "On relaunch, pre-activates sessions active within the last N days in the background (0 = off). Pre-activated sessions open instantly; each one is a real process, so keep the cap in mind.",
  "自动激活总数上限": "Auto-activation process cap",
  "每组预载条数": "Preload count per group",
  "每个 工作区×CLI 组按时间序预载的最新条数（1–8，默认 1）。设为 1 可保证每组的最新一条点击秒开。":
    "Newest sessions preloaded per workspace × CLI group by recency (1–8, default 1). Set to 1 to guarantee the latest session of every group opens instantly.",
  "预激活的进程总数硬上限（1–32，默认 16）。超出后按时间降序只保留最近的会话。":
    "Hard cap on pre-activated processes (1–32, default 16). Beyond it, only the most recent sessions are kept.",
  "默认": "Default",
  "风铃": "Chime",
  "铃声": "Bell",
  "叮咚": "Ding",

  // ShortcutTab
  "外壳与终端": "Shell & terminal",
  "未绑定": "Not bound",
  "搜索命令、键位或 id…": "Search commands, keys, or id…",
  "没有匹配的命令": "No matching commands",

  // SettingsPanel / index.tsx
  "设置": "Settings",
  "返回应用": "Back to app",
  "设置面板与主题/行为配置": "Settings panel and theme/behavior configuration",
  "基础设置": "Basics",
  "外观、行为和环境的基础配置。": "Basic configuration for appearance, behavior, and environment.",
  "外观": "Appearance",
  "行为": "Behavior",
  "快捷键": "Shortcuts",

  // IconDecorCard
  "图标装饰": "Icon decorations",
  "逐图标自定义颜色与呼吸闪烁;有开关两态的图标仅作用于点亮色。":
    "Per-icon color and breathing glow; for icons with on/off states only the lit color is themed.",
  "SSH 入口": "SSH entry",
  "网络代理": "Network proxy",
  "文件面板": "Files panel",
  "Git 面板": "Git panel",
  "审批线面板": "Checkpoints panel",
  "Memory 面板": "Memory panel",
  "颜色": "Color",
  "闪烁": "Breathing",
  "恢复默认": "Reset to default",
} as Record<string, string>;
