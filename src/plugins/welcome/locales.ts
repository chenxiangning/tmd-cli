/**
 * welcome 域词典(welcome 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。自 kernel/locales 迁出(2026-09-12 插件词典纪律)。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · welcome 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
const MESSAGES_EN = {
  /* 欢迎页(终端窗体) */
  "引擎选择器": "engine picker",
  "GitHub 仓库": "GitHub repository",
  "新会话的工作区": "Workspace for the new session",
  "↑↓ 选引擎 · ⏎ 以所选工作区启动新会话 · 点击 ● 展开凭据额度":
    "↑↓ pick engine · ⏎ new session in selected workspace · click ● to expand credentials & quota",
  "刷新首页数据": "Refresh home data",
  "移动游标": "move cursor",
  "启动新会话": "start new session",
  "展开凭据与额度": "expand credentials & quota",
  /* 引擎卡 */
  "官方文档": "Docs",
  "探针中…": "Probing…",
  "已安装": "Installed",
  "未安装": "Not installed",
  "探针失败": "Probe failed",
  "已是最新": "Up to date",
  "最新版本 {version}": "Latest version {version}",
  "最新版本 {version},点\"更新\"升级":
    "Latest version {version} — click \"Update\" to upgrade",
  "更新": "Update",
  "重装": "Reinstall",
  "新会话": "New session",
  "更新到 {version}": "Update to {version}",
  "重新安装/更新到最新版": "Reinstall/update to latest",
  "重新探针": "Re-probe",
  "安装": "Install",
  "先安装 {name}": "Install {name} first",

  /* 前置依赖引导 */
  "探针前置依赖 {name}…": "Probing prerequisite {name}…",
  "前置依赖 {name} 探针失败": "Prerequisite {name} probe failed",
  "依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎":
    "Requires the {name} runtime — install {name} first, then install/update this engine",
  "{name} 官网": "{name} website",
  "{name} 安装": "{name} install",
  "正在安装 {name}…": "Installing {name}…",
  "安装 {name}": "Install {name}",
  "重新探针前置依赖": "Re-probe prerequisite",

  /* 安装日志 */
  "{label}完成": "{label} complete",
  "{label}失败,日志见上方": "{label} failed — see log above",

  /* 凭据/额度区 */
  "无已登录供应商": "No signed-in providers",
  "凭据与额度{arrow}": "Credentials & quota{arrow}",
  "(点击展开)": " (click to expand)",
  "(点击收起)": " (click to collapse)",
  "已登录": "Signed in",
  "已登录(ChatGPT 订阅)": "Signed in (ChatGPT plan)",
  "已登录;官方订阅额度请在 CLI 内 /usage 查看":
    "Signed in; check plan usage with /usage in the CLI",
  "凭据缺失": "Credential missing",
  "暂不支持该供应商": "Provider not supported yet",
  "{label}窗口 · 已使用 {pct}%": "{label} window · {pct}% used",
  "{base} · 重置于 {at}({relative})": "{base} · resets {at} ({relative})",
  "重置{time} · {relative}": "Resets {time} · {relative}",
  "{m}月{d}日": "{m}/{d}",

  /* 页脚 RESUME / QUOTA */
  "续作": "resume",
  "套餐水位": "plan usage",
  "暂无历史会话": "No sessions yet",
  "暂无可查询的套餐额度": "No queryable plan quota",
  "重置{rel}": "resets {rel}",

  /* 页脚下方 tokens 用量 dashboard */
  "用量": "usage",
  "今日": "today",
  "7 日": "7d",
  "消耗会话": "sessions",
  "pi 系费用": "pi-family cost",
  "输出": "output",
  "输入+缓存": "input+cache",
  "近 7 日无消费": "No usage in the last 7 days",
  "用量数据加载失败": "Failed to load usage",
  "重试": "retry",
  "数据源 = 本地会话记录,仅统计近 7 日":
    "Source: local session logs, last 7 days only",
  /* 插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "欢迎页": "Welcome page",
  "无会话首页:引擎全动作行、凭据额度、续作":
    "No-session home: engine action rows, credentials & quota, resume",
} as Record<string, string>;

/** ja 词典 · welcome 域(键 = 中文源串,由文案迁移按归属写入;zh 恒等无词典)。 */
const MESSAGES_JA = {
  /* 欢迎页(终端窗体) */
  "引擎选择器": "エンジンピッカー",
  "GitHub 仓库": "GitHub リポジトリ",
  "新会话的工作区": "新規セッションのワークスペース",
  "↑↓ 选引擎 · ⏎ 以所选工作区启动新会话 · 点击 ● 展开凭据额度":
    "↑↓ エンジン選択 · ⏎ 選択ワークスペースで新規セッション · ● クリックで認証情報と使用量を表示",
  "刷新首页数据": "ホームデータを更新",
  "移动游标": "カーソル移動",
  "启动新会话": "新規セッション開始",
  "展开凭据与额度": "認証情報と使用量を展開",

  /* 引擎卡 */
  "官方文档": "ドキュメント",
  "探针中…": "プローブ中…",
  "已安装": "インストール済み",
  "未安装": "未インストール",
  "探针失败": "プローブ失敗",
  "已是最新": "最新です",
  "最新版本 {version}": "最新バージョン {version}",
  "最新版本 {version},点\"更新\"升级":
    "最新バージョン {version}。「更新」でアップグレード",
  "更新": "更新",
  "重装": "再インストール",
  "新会话": "新規セッション",
  "更新到 {version}": "{version} に更新",
  "重新安装/更新到最新版": "再インストール/最新版へ更新",
  "重新探针": "再プローブ",
  "安装": "インストール",
  "先安装 {name}": "先に {name} をインストール",

  /* 前置依赖引导 */
  "探针前置依赖 {name}…": "前置依存 {name} をプローブ中…",
  "前置依赖 {name} 探针失败": "前置依存 {name} のプローブに失敗",
  "依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎":
    "{name} ランタイムが必要 —— 先に {name} をインストールしてから本エンジンを導入/更新",
  "{name} 官网": "{name} 公式サイト",
  "{name} 安装": "{name} インストール",
  "正在安装 {name}…": "{name} をインストール中…",
  "安装 {name}": "{name} をインストール",
  "重新探针前置依赖": "前置依存を再プローブ",

  /* 安装日志 */
  "{label}完成": "{label}完了",
  "{label}失败,日志见上方": "{label}失敗。ログは上を参照",

  /* 凭据/额度区 */
  "无已登录供应商": "ログイン済みプロバイダなし",
  "凭据与额度{arrow}": "認証情報と使用量{arrow}",
  "(点击展开)": "（クリックで展開）",
  "(点击收起)": "（クリックで折りたたみ）",
  "已登录": "ログイン済み",
  "已登录(ChatGPT 订阅)": "ログイン済み(ChatGPT プラン)",
  "已登录;官方订阅额度请在 CLI 内 /usage 查看":
    "ログイン済み。公式プランの使用量は CLI 内 /usage で確認",
  "凭据缺失": "認証情報なし",
  "暂不支持该供应商": "このプロバイダは未対応",
  "{label}窗口 · 已使用 {pct}%": "{label}ウィンドウ · 使用 {pct}%",
  "{base} · 重置于 {at}({relative})": "{base} · リセット {at}({relative})",
  "重置{time} · {relative}": "リセット {time} · {relative}",
  "{m}月{d}日": "{m}月{d}日",

  /* 页脚 RESUME / QUOTA */
  "续作": "続きから",
  "套餐水位": "プラン使用量",
  "暂无历史会话": "セッション履歴なし",
  "暂无可查询的套餐额度": "照会可能なプラン使用量なし",
  "重置{rel}": "リセット {rel}",

  /* ページフッター下の tokens 使用量ダッシュボード */
  "用量": "使用量",
  "今日": "今日",
  "7 日": "7日",
  "消耗会话": "セッション",
  "pi 系费用": "pi 系コスト",
  "输出": "出力",
  "输入+缓存": "入力+キャッシュ",
  "近 7 日无消费": "過去 7 日間の利用なし",
  "用量数据加载失败": "使用量の読み込みに失敗しました",
  "重试": "再試行",
  "数据源 = 本地会话记录,仅统计近 7 日":
    "ソース:ローカルセッション記録(過去 7 日のみ)",

  /* 插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "欢迎页": "ウェルカムページ",
  "无会话首页:引擎全动作行、凭据额度、续作":
    "無セッション時のホーム:エンジン操作行、認証情報と使用量、続きから",
} as Record<string, string>;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
