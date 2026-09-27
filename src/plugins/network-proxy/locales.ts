/**
 * network-proxy 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · network-proxy 域。 */
const MESSAGES_EN = {
  "网络代理": "Network Proxy",
  "关闭": "Close",
  "启用网络代理": "Enable network proxy",
  "客户端联网与新建 CLI 会话走该代理": "Client network traffic and new CLI sessions go through this proxy",
  "代理地址": "Proxy address",
  "支持 http(s) / socks5 / socks5h。开关即时生效;已在跑的旧会话需手动重启后走代理。":
    "Supports http(s) / socks5 / socks5h. Takes effect immediately; running sessions need a manual restart to use the proxy.",
  "代理地址格式无效,应为 http(s)://host:port 或 socks5://host:port。":
    "Invalid proxy address; expected http(s)://host:port or socks5://host:port.",
  "不支持的代理协议 {protocol},仅支持 http(s) / socks5。":
    "Unsupported proxy scheme {protocol}; only http(s) / socks5 are supported.",
  "代理地址缺少主机名。": "Proxy address is missing a hostname.",
} as const;

/** ja 词典 · network-proxy 域。 */
const MESSAGES_JA = {
  "网络代理": "ネットワークプロキシ",
  "关闭": "閉じる",
  "启用网络代理": "ネットワークプロキシを有効化",
  "客户端联网与新建 CLI 会话走该代理": "クライアントの通信と新規 CLI セッションがこのプロキシを経由します",
  "代理地址": "プロキシアドレス",
  "支持 http(s) / socks5 / socks5h。开关即时生效;已在跑的旧会话需手动重启后走代理。":
    "http(s) / socks5 / socks5h に対応。切り替えは即時反映。実行中のセッションは手動再起動後に適用されます。",
  "代理地址格式无效,应为 http(s)://host:port 或 socks5://host:port。":
    "プロキシアドレスの形式が不正です。http(s)://host:port または socks5://host:port を指定してください。",
  "不支持的代理协议 {protocol},仅支持 http(s) / socks5。":
    "未対応のプロキシスキーム {protocol}。http(s) / socks5 のみ対応です。",
  "代理地址缺少主机名。": "プロキシアドレスにホスト名がありません。",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
