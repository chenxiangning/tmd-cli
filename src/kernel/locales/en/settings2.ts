/** en 词典 · settings2 域(web-access 自建服务器中继:2026-09-24 tab 拆分新增;键 = 中文源串)。 */
export const MESSAGES = {
  // tabs(index.tsx 贡献)
  "自建服务器": "Self-hosted server",
  "设备": "Devices",
  // WebCfPane(Cloudflare tab;① 文案改口,只讲 Worker 一键)
  "中继是跑在你自己 Cloudflare 账号的 Worker(免费额度够),只做字节转发、零存储。左卡填 Cloudflare API Token 点「立即部署」即可,Token 仅本次使用、不保存。":
    "The relay is a Worker on your own Cloudflare account (the free tier is enough) — pure byte forwarding, zero storage. Just fill in a Cloudflare API token on the left card and hit Deploy; the token is used only for this deployment and never stored.",
  // WebSelfHostPane(自建 tab 三步卡)
  "① 一键部署(一次性)": "① One-click deploy (one-time)",
  "给你一台有公网 IP 的服务器(Node ≥ 18,SSH 可达),左卡填 SSH 信息点「一键部署」:桌面自动上传中继服务、现场签发 443 TLS 证书、装 systemd、健康自检。凭据只进本次调用,不保存。":
    "Give it any server with a public IP (Node ≥ 18, SSH-reachable): fill the SSH details on the left card and hit Deploy — the desktop uploads the relay service, mints a 443 TLS certificate on the spot, installs the systemd unit, and runs a health check. Credentials stay inside this single call and are never stored.",
  "连接成功后,右卡「手机打开」里的地址已带访问令牌,手机浏览器直接开,加到主屏幕即当 app 用。自签证书由两端证书钉住校验,换服务器重新部署+重新扫码即可。令牌=门禁,别转发;用完回这里点「断开」。":
    "Once connected, the “Open on phone” address carries the access token — open it in your phone browser and add it to the home screen to use like an app. The self-signed certificate is checked by certificate pinning on both ends; switching servers just means redeploying and re-scanning the pairing code. The token is the gate: don't share it; come back and hit “Disconnect” when done.",
  // WebSelfHostCard(一键部署卡)
  "一键部署到自建服务器": "One-click deploy to your own server",
  "桌面经 SSH 自动完成:上传服务、现场签发 TLS 证书、安装 systemd、健康自检。凭据仅本次部署使用,不保存。":
    "Fully automated over SSH from the desktop: upload the service, mint a TLS certificate on the spot, install systemd, run a health check. Credentials are used only for this deployment and never stored.",
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
