/**
 * ports 域词典(插件自带,i18n.registerMessages 注册)。键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · ports 域。 */
const MESSAGES_EN = {
  "端口管理": "Ports",
  "刷新": "Refresh",
  "搜索端口 / 进程 / 仓库…": "Search ports / processes / repos…",
  "平台:{os} · 工具:{source}": "Platform: {os} · Tool: {source}",
  "{n} 个端口 · {m} 个进程": "{n} ports · {m} processes",
  "扫描失败:{error}": "Scan failed: {error}",
  "部分信息获取失败:{n} 项": "{n} lookups failed (hover for details)",
  "Windows 无法读取进程 cwd,仓库标注不可用": "Windows cannot read process cwd — repo labels unavailable",
  "正在扫描…": "Scanning…",
  "没有监听中的 TCP 端口": "No listening TCP ports",
  "确认终止进程": "Confirm kill",
  "终止进程": "Kill process",
  "终止中…": "Killing…",
  "终止失败:{error}": "Kill failed: {error}",
  "结束监听 {addr}:{port} 的进程 pid {pid}?对应服务将停止。":
    "Kill pid {pid} listening on {addr}:{port}? The service will stop.",
  "局域网": "LAN",
  "仅本机": "Local",
  "新出现": "NEW",
  "已复制": "Copied",
  "复制地址": "Copy address",
  "浏览器打开": "Open in browser",
  "复制终止命令:{cmd}": "Copy kill command: {cmd}",
  "由本应用会话启动,点击跳转会话": "Started by a tmd-cli session — click to jump",
  "折叠子进程": "Collapse child processes",
} as const;

/** ja 词典 · ports 域。 */
const MESSAGES_JA = {
  "端口管理": "ポート管理",
  "刷新": "更新",
  "搜索端口 / 进程 / 仓库…": "ポート / プロセス / リポジトリを検索…",
  "平台:{os} · 工具:{source}": "プラットフォーム:{os} · ツール:{source}",
  "{n} 个端口 · {m} 个进程": "{n} ポート · {m} プロセス",
  "扫描失败:{error}": "スキャン失敗:{error}",
  "部分信息获取失败:{n} 项": "{n} 件の取得に失敗(ホバーで詳細)",
  "Windows 无法读取进程 cwd,仓库标注不可用": "Windows はプロセスの cwd を読めず、リポジトリ表示は無効",
  "正在扫描…": "スキャン中…",
  "没有监听中的 TCP 端口": "待ち受け中の TCP ポートはありません",
  "确认终止进程": "プロセス終了の確認",
  "终止进程": "プロセスを終了",
  "终止中…": "終了中…",
  "终止失败:{error}": "終了に失敗:{error}",
  "结束监听 {addr}:{port} 的进程 pid {pid}?对应服务将停止。":
    "{addr}:{port} で待ち受け中の pid {pid} を終了しますか?対応するサービスは停止します。",
  "局域网": "LAN",
  "仅本机": "ローカル",
  "新出现": "新規",
  "已复制": "コピーしました",
  "复制地址": "アドレスをコピー",
  "浏览器打开": "ブラウザで開く",
  "复制终止命令:{cmd}": "終了コマンドをコピー:{cmd}",
  "由本应用会话启动,点击跳转会话": "tmd-cli セッションが起動 — クリックでセッションへ",
  "折叠子进程": "子プロセスを折りたたむ",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
