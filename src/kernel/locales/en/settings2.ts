/** en 词典 · settings2 域(web-access 自建服务器中继:2026-09-24 tab 拆分新增;键 = 中文源串)。 */
export const MESSAGES = {
  // tabs(index.tsx 贡献)
  "自建服务器": "Self-hosted server",
  "设备": "Devices",
  // WebCfPane(Cloudflare tab;① 大白话改口)
  "没有自己的服务器就走这条:中继跑在你自己的 Cloudflare 账号上(免费额度就够),只搬字节、不存内容。左卡贴上 Cloudflare API Token 点「立即部署」,地址和密钥自动填进右卡;Token 只用这一次,不保存。":
    "No server of your own? Take this route: the relay runs as a Worker on your Cloudflare account (the free tier is enough) — it only shuttles bytes and stores nothing. Paste a Cloudflare API token on the left card and hit Deploy; the URL and key land on the right card automatically. The token is used once and never stored.",
  // WebSelfHostPane(自建 tab 三步卡)
  "① 一键部署(只做一次)": "① One-click deploy (once)",
  "手边有一台带公网 IP 的服务器(阿里云/腾讯云轻量都行,装好 Node ≥ 18)?左卡填它的 IP、SSH 用户名、密码,点「一键部署」:上传中继、签证书、装服务全自动。成功后服务器记进「部署历史」,下次点一下就回填,重输密码即可。":
    "Got a server with a public IP (any cheap VPS will do, with Node ≥ 18 installed)? Fill its IP, SSH username and password on the left card and hit Deploy — uploading the relay, minting the certificate and installing the service all run automatically. Afterwards the server lands in “Deploy history”: next time click it to refill the form and just retype the password.",
  "右卡「手机打开」的地址,手机浏览器直接开,加到主屏幕就当 app 用。地址里带的令牌就是钥匙,别转发给别人;用完回这里点「断开」。":
    "Open the “Open on phone” URL from the right card in your phone browser, then add it to the home screen and it works like an app. The token in the URL is the key — don't forward it; hit “Disconnect” here when you're done.",
  // WebSelfHostCard(一键部署卡)
  "一键部署到自建服务器": "One-click deploy to your own server",
  "桌面经 SSH 自动完成:上传服务、现场签发 TLS 证书、安装 systemd、健康自检。密码和私钥不保存,下次部署从历史点一下回填,重输密码即可。":
    "Fully automated over SSH from the desktop: upload the service, mint a TLS certificate on the spot, install systemd, run a health check. Passwords and private keys are never stored — next time, pick the server from the history below and just retype the password.",
  "部署历史(点一下回填,密码/私钥需重输)": "Deploy history (click to refill; retype the password/key)",
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
} as Record<string, string>;
