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
  "提示音音量": "Notification volume",
  "命令类只填可执行文件名,参数写 args 字段(空格串会被当作路径查找而失败)。":
    "For command targets, put only the executable name — parameters go in the args field (a string with spaces fails path lookup).",
  "作用于 Ask 提示音与结束提示音。": "Applies to both the ask sound and the turn-end sound.",
  "结束提示音": "Turn-end sound",
  "一轮对话结束且未被查看时播放（结算后静默 3 秒确认，中途来新输出不响）。":
    "Plays when a turn ends unseen (confirmed after 3 silent seconds; it stays silent if new output arrives meanwhile).",
  "结束音效": "Turn-end sound effect",
  "选择轮次结束提示音音效，「试听」立即播放。": "Choose the turn-end sound; “Preview” plays it immediately.",
  "后台提醒": "Background notifications",
  "窗口失焦时，当前会话完成一轮对话也标记未读并播放结束提示音；切回窗口即恢复已读。":
    "While the window is unfocused, a finished turn still marks the session unread and plays the turn-end sound; focusing the window clears it.",
  "会话自动清理": "Session auto-cleanup",
  "超过设定时长没有活动的会话自动转入归档；其中从未发过消息的空会话直接删除。工作区展开或手动刷新时执行，不后台轮询。":
    "Sessions idle past the chosen window move to the archive; ones that never received a message are deleted outright. Runs when a workspace is expanded or refreshed — no background polling.",
  "超期时长": "Idle window",
  "以会话最后活动时间计算；置顶与手动恢复过的会话不清理。":
    "Measured from the session's last activity; pinned and manually restored sessions are never swept.",
  "12 小时": "12 hours",
  "24 小时": "24 hours",
  "48 小时": "48 hours",
  "7 天": "7 days",
  "默认": "Default",
  "风铃": "Chime",
  "铃声": "Bell",
  "叮咚": "Ding",

  // ShortcutTab
  "外壳与终端": "Shell & terminal",
  "未绑定": "Not bound",
  "未设置": "Not set",
  "搜索命令、键位或 id…": "Search commands, keys, or id…",
  "没有匹配的命令": "No matching commands",
  "已修改": "Modified",
  "内置": "Built-in",
  "此命令为内置键位,不可改": "This command has a built-in binding and cannot be changed",
  "点击录制新的快捷键": "Click to record a new shortcut",
  "录制中…": "Recording…",
  "按 Esc 取消 · Backspace 解绑": "Press Esc to cancel · Backspace to unbind",
  "Escape 不可绑定": "Escape cannot be bound",
  "需含 ⌘/Ctrl/Shift/Alt 之一": "Requires ⌘/Ctrl/Shift/Alt",
  "键位格式错误": "Invalid key syntax",
  "与 {id} 占用,无法使用": "Conflicts with {id}; cannot use",
  "恢复默认": "Reset to default",
  "全部重置": "Reset all",

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

  // cli-config「CLI 独立配置」(index / CliConfigTab / ConfigForm / ModelPicker / FieldControls / ChainPicker)
  "CLI 独立配置": "Standalone CLI config",
  "图形化编辑各 CLI 的本地配置文件 —— 不用记命令、不用手改磁盘文件;保存即写回原文件,未知内容原样保留。":
    "Edit each CLI's local config file graphically — no commands to memorize, no hand-editing files on disk; saving writes back to the original file, unknown content is preserved as-is.",
  "引擎": "Engines",
  "尚无引擎贡献配置面。": "No engines have contributed config panels yet.",
  "读取配置清单…": "Loading config sources…",
  "未创建": "Not created",
  "原始编辑": "Raw edit",
  "返回 GUI": "Back to GUI",
  "读取配置…": "Loading config…",
  "无法读取配置文件": "Cannot read the config file",
  "无法解析配置文件": "Cannot parse the config file",
  "● 未保存的更改": "● Unsaved changes",
  "放弃": "Discard",
  "保存到磁盘": "Save to disk",
  "已保存到磁盘(首次写入前已留 .bak-tmd 备份)":
    "Saved to disk (a .bak-tmd backup is kept before the first write)",
  "高级": "Advanced",
  "说明": "Notes",
  "供应商": "Provider",
  "强度": "Level",
  "当前值": "Current value",
  "候选": "Candidates",
  "值": "Value",
  "键": "Key",
  "添加候选": "Add candidate",

  // cli-shared 供应商渠道(providerChannels;渲染点 = cli-config 引擎面板)
  "供应商渠道": "Provider channels",
  "点击行即切换 · 对新会话生效": "Click a row to switch · applies to new sessions",
  "还没有自定义渠道": "No custom channels yet",
  "点击右上角「添加渠道」创建": "Click “Add channel” at the top right to create one",
  "读取渠道…": "Loading channels…",
  "导入 ccswitch": "Import from ccswitch",
  "添加渠道": "Add channel",
  "编辑渠道": "Edit channel",
  "说明(可选)": "Remark (optional)",
  "模型(可选)": "Model (optional)",
  "API 地址": "API URL",
  "同名渠道已存在:{name}": "A channel named “{name}” already exists",
  "已切换:{name}": "Switched to {name}",
  "cc-switch 没有 {engine} 的渠道": "cc-switch has no {engine} channels",
  "已导入 cc-switch:新增 {added},更新 {updated},跳过 {skipped}":
    "Imported from cc-switch: {added} added, {updated} updated, {skipped} skipped",
  "未检测到 cc-switch 数据(本机没有 ~/.cc-switch/)":
    "No cc-switch data found (~/.cc-switch/ is missing on this machine)",
  "确认删除": "Confirm delete",

  // web-access(Web 访问:LAN 卡 / 外网中继 / 部署 / 风险弹窗 / 徽标)
  "内网 Web 访问": "LAN web access",
  "已开启": "On",
  "已关闭": "Off",
  "同一 Wi-Fi 下的手机/平板浏览器打开下方地址即可访问本机会话。地址含一次性 token,每次启动都会重新生成,不要转发给他人。":
    "Open the address below in a phone/tablet browser on the same Wi-Fi to reach this machine's sessions. The address carries a one-time token that is regenerated on every start — don't share it with anyone.",
  "复制地址": "Copy address",
  "当前正通过 Web 访问查看(权限与本机相同)":
    "You are viewing via web access (same permissions as this machine)",
  "使用流程": "How it works",
  "当前为 Web 只读视图:中继的部署/连接/断开只能在桌面端操作。":
    "This is a read-only web view: deploying, connecting, and disconnecting the relay can only be done on the desktop.",
  "连接中继": "Connect relay",
  "手机在外网经中继访问本机;中继只认 key 搬字节,桥内仍走 token/设备授权。":
    "Phones reach this machine from outside networks through the relay; the relay trusts nothing but the key to move bytes — inside the bridge it's still token/device-authorized.",
  "中继 Worker URL(如 https://tmd-relay.<sub>.workers.dev)":
    "Relay Worker URL (e.g. https://tmd-relay.<sub>.workers.dev)",
  "中继密钥(部署时自动铸造,或自行设强密码)":
    "Relay key (minted automatically on deploy, or set your own strong passphrase)",
  "断开": "Disconnect",
  "当前正通过中继查看(权限与本机相同)":
    "You are viewing through the relay (same permissions as this machine)",
  "未连接": "Not connected",
  "部署中继(自有 Cloudflare 账号)": "Deploy the relay (your own Cloudflare account)",
  "① 部署中继(一次性)": "① Deploy the relay (one-time)",
  "中继是跑在你自己 Cloudflare 账号的 Worker(免费额度够),只做字节转发、零存储。左卡任选一种:填 Cloudflare API Token 一键部署,或导 zip 到你的 ECS / 任意机器 wrangler deploy。":
    "The relay is a Worker on your own Cloudflare account (free tier is enough) — pure byte forwarding, zero storage. Pick either way on the left card: one-click deploy with a Cloudflare API token, or export the zip and wrangler deploy on your ECS / any machine.",
  "② 连接中继(每次用前)": "② Connect to the relay (before each use)",
  "右卡填中继 URL 和密钥(一键部署会自动回填),点「连接中继」。桌面会主动外拨一条加密长连,状态点转绿即外网可达。会顺带打开内网桥,不用先去内网 tab。":
    "Fill the relay URL and secret on the right card (one-click deploy autofills them) and hit “Connect”. The app dials out an encrypted long-lived connection — the dot turns green once reachable from the internet. The LAN bridge opens along the way; no need to visit the LAN tab first.",
  "③ 手机打开外网地址": "③ Open the public URL on your phone",
  "连接成功后,右卡「手机打开」里的地址已带访问令牌,手机 Safari 直接开,加到主屏幕即当 app 用。令牌=门禁,别转发;用完回这里点「断开」。":
    "Once connected, the “Open on phone” address carries the access token — open it directly in mobile Safari and add to home screen to use like an app. The token is the gate: don't share it; come back and hit “Disconnect” when done.",
  "中继跑在你自己的 Cloudflare 账号(免费额度足够)。API Token 仅本次部署使用,不保存。":
    "The relay runs on your own Cloudflare account (the free tier is enough). The API token is used only for this deployment and never stored.",
  "Cloudflare API Token 怎么申请?": "How do I get a Cloudflare API token?",
  "开 Cloudflare Dashboard → 右上角头像 → My Profile → 左侧 API Tokens → Create Token":
    "Open the Cloudflare Dashboard → avatar at the top right → My Profile → API Tokens on the left → Create Token",
  "模板选 Edit Cloudflare Workers(或 Custom:Account 权限勾 Workers Scripts:Edit + Account Settings:Read)":
    "Pick the Edit Cloudflare Workers template (or Custom: under Account check Workers Scripts:Edit + Account Settings:Read)",
  "Account Resources 选你的账号 → Continue → Create Token → 复制粘贴到下面":
    "Under Account Resources pick your account → Continue → Create Token → paste it below",
  "Account ID 在 Dashboard 右侧栏(Workers 页)或任意域名 Overview 右下角;用 cfat_ 账户令牌时必填":
    "The Account ID is in the Dashboard sidebar (Workers page) or the bottom-right of any domain's Overview; required for cfat_ account tokens",
  "直达:Cloudflare API Tokens 页面": "Direct link: Cloudflare API Tokens page",
  "Cloudflare API Token (My Profile → API Tokens)": "Cloudflare API Token (My Profile → API Tokens)",
  "Account ID(可选,cfat_ 账户令牌必填)":
    "Account ID (optional; required for cfat_ account tokens)",
  "中继密钥(留空则导出时铸随机 key 烧入包内)":
    "Relay key (leave empty to mint a random key baked into the exported package)",
  "保存中继部署包": "Save relay deployment package",
  "已导出部署包:": "Deployment package exported: ",
  "部署完成:": "Deployed: ",
  "部署中…": "Deploying…",
  "立即部署": "Deploy now",
  "导出部署包": "Export deployment package",
  "外网访问:请先了解风险": "Outside access: understand the risks first",
  "开启后,任何知道你中继地址和密钥的人都能读写文件、运行终端命令、消耗 API 额度 —— 权限与本机完全相同。":
    "Once enabled, anyone who knows your relay address and key can read and write files, run terminal commands, and burn API quota — with permissions identical to this machine.",
  "安全约定:": "Safety rules:",
  "密钥即唯一凭据,持有者与本机等权":
    "The key is the sole credential — whoever holds it has the same rights as this machine",
  "不转发中继地址或密钥": "Don't share the relay address or key",
  "用完即断开中继": "Disconnect the relay when done",
  "桌面重启后密钥自动重铸,旧链接即失效":
    "The key is re-minted on desktop restart; old links stop working",
  "我已了解并自行承担风险": "I understand the risks and accept them",
  "有浏览器客户端正通过 Web 访问控制本机":
    "A browser client is controlling this machine via web access",
  "远程控制中": "Remote control active",
} as Record<string, string>;
