/** en 词典 · settings2 域(settings.ts 溢出收纳:web-access 自建服务器中继 + 后续
 * 溢出词条;键 = 中文源串)。 */
export const MESSAGES = {
  // tabs(index.tsx 贡献)
  "自建服务器": "Self-hosted server",
  "设备": "Devices",
  // WebCfPane(Cloudflare tab;① 大白话改口)
  "没有自己的服务器就走这条:中继跑在你自己的 Cloudflare 账号上(免费额度就够),只搬字节、不存内容。左卡贴上 Cloudflare API Token 点「立即部署」,地址和密钥自动填进右卡;Token 只用这一次,不保存。":
    "No server of your own? Take this route: the relay runs as a Worker on your Cloudflare account (the free tier is enough) — it only shuttles bytes and stores nothing. Paste a Cloudflare API token on the left card and hit Deploy; the URL and key land on the right card automatically. The token is used once and never stored.",
  // WebSelfHostPane(自建 tab 三步卡)
  "① 一键部署(只做一次)": "① One-click deploy (once)",
  "手边有一台带公网 IP 的服务器(阿里云/腾讯云轻量都行,装好 Node ≥ 18)?左卡填它的 IP、SSH 用户名、密码,点「一键部署」:上传中继、签证书、装服务全自动。成功后服务器记进「部署历史」,下次点一下整表回填,直接再部署。":
    "Got a server with a public IP (any cheap VPS will do, with Node ≥ 18 installed)? Fill its IP, SSH username and password on the left card and hit Deploy — uploading the relay, minting the certificate and installing the service all run automatically. Afterwards the server lands in “Deploy history”: next time one click refills the whole form and you can deploy again right away.",
  // WebSelfHostCard(一键部署卡)
  "桌面经 SSH 自动完成:上传服务、现场签发 TLS 证书、安装 systemd、健康自检。成功后服务器记进下方「部署历史」,下次点一下整表回填;密码随历史保存在本机设置文件(与 SSH 主机清单同等纪律),私钥内容不保存。":
    "Fully automated over SSH from the desktop: upload the service, mint a TLS certificate on the spot, install systemd, run a health check. Afterwards the server lands in “Deploy history” below — one click refills the whole form. The password is stored with the history in your local settings file (same discipline as the SSH host list); private key contents are never stored.",
  "部署历史(点一下回填;密码随历史存本机,私钥需重贴或填路径)": "Deploy history (click to refill; the password is stored locally with the history, paste the key again or fill its path)",
  "服务器 IP 或域名 *": "Server IP or hostname *",
  "SSH 密码": "SSH password",
  "私钥内容(粘贴;留空则按下方路径读取)":
    "Private key (paste; read from the path below if empty)",
  "SSH 连接": "SSH connect",
  "签发证书": "Mint certificate",
  "上传部署": "Upload files",
  "安装服务": "Install service",
  "健康自检": "Health check",
  "(URL/密钥已回填右卡)": "(URL/key autofilled on the right card)",
  "保存自建中继部署包": "Save self-hosted relay package",
  "信任并重试": "Trust and retry",
  "一键部署": "One-click deploy",
  "手动部署指导(一键失败时的兜底)": "Manual deployment guide (fallback when one-click fails)",
  "前置要求:": "Prerequisites:",
  "服务器有公网可达 IP;装好 Node.js ≥ 18;用 root(或免密 sudo)部署;云安全组放行 80 与 443 端口。":
    "A server with a publicly reachable IP; Node.js ≥ 18 installed; deploy as root (or passwordless sudo); open ports 80 and 443 in the cloud security group.",
  "解包后按序执行(把包目录整个传到服务器,再起服务、验活):":
    "After unpacking, run these in order (copy the whole package directory to the server, then start the service and verify):",
  "第 3 条在桌面执行:回 no agent = 服务活着、正等桌面拨号;连接中继后回 agent connected。":
    "Run the third one from the desktop: “no agent” means the service is up and waiting for the desktop to dial; after connecting the relay it answers “agent connected”.",
  // 打开方式(OpenWithTab 帮助行;settings.ts 满行,溢出收纳)
  "文件底部工具条右侧用默认应用直开;菜单里选择即按文件扩展名记忆并打开。":
    "The file footer bar opens with the default target; picking from the menu is remembered per file extension and opens right away.",
  "按扩展名记忆的默认只作用于该类型;未记忆的类型与无扩展名文件回落此处的全局默认。":
    "An extension-remembered default applies only to that type; unremembered types and extension-less files fall back to the global default here.",
  // 会话卫生卡(HygieneCard 说明行)
  "清扫随会话磁盘扫描自动进行(展开工作区或手动刷新即触发),暂无独立的手动清扫入口与上次清扫回执。":
    "Sweeping rides on session disk scans (triggered by expanding a workspace or a manual refresh); there is no standalone manual sweep or last-sweep receipt yet.",
  // 行为卡:历史输入补全(BehaviorTab + PromptHistoryManager,2026-10 i18n 收口)
  "历史输入补全": "Input history completion",
  "输入时按 Tab 接受历史补全建议;输入框为空时按 ↑↓ 翻阅历史。":
    "Tab accepts a history suggestion while typing; with the input empty, ↑↓ browses history.",
  "管理历史记录": "Manage history",
  "暂无历史记录": "No history yet",
  "清空全部输入历史": "Clear all input history",
  "清空全部": "Clear all",
  "确认清空?": "Confirm clear?",
  // 快捷键 tab「全部重置」两步武装(ShortcutTab,循 PromptHistoryManager 先例)
  "确认重置?": "Confirm reset?",
  "删除此条历史记录": "Delete this history entry",
  // 打开方式卡(OpenWithTab,2026-10 i18n 收口)
  "添加打开方式": "Add open-with app",
  "浏览…选择应用": "Browse… to pick an app",
  "已添加": "Added",
  "探测中": "Probing",
  "点击重新探测": "Click to probe again",
  "设为默认": "Set as default",
  // cli-config 草稿丢弃确认 + GUI 保存失败错误条(CliConfigTab/ConfigForm)
  "丢弃未保存的修改?": "Discard unsaved changes?",
  "当前配置有未保存的修改,切换后将丢弃这些修改。":
    "This config has unsaved changes; switching will discard them.",
  "丢弃修改": "Discard changes",
  "关闭错误提示": "Dismiss error",
} as Record<string, string>;
