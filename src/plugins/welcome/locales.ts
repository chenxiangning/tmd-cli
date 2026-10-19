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
  "版本获取失败": "version lookup failed",
  "最新版查询失败,点右上刷新按钮重试": "Latest version lookup failed — use the refresh button at top right to retry",
  /* 引擎卡 */
  "官方文档": "Docs",
  "探针中…": "Probing…",
  "已安装": "Installed",
  "未安装": "not installed",
  "探针失败": "Probe failed",
  "已是最新": "Up to date",
  '当前 {current},最新 {version},点"更新"升级':
    "Current {current}, latest {version} — click \"Update\" to upgrade",
  "更新": "Update",
  "重装": "Reinstall",
  "新会话": "New session",
  "更新到 {version}": "Update to {version}",
  "重新安装/更新到最新版": "Reinstall/update to latest",
  "重新探针": "Re-probe",
  "版本": "Version",
  "安装指定版本(回退/收藏)": "Install a specific version (rollback/favorites)",
  "当前版本": "Current version",
  "当前": "Current",
  "收藏": "Favorites",
  "收藏该版本": "Favorite this version",
  "取消收藏该版本": "Unfavorite this version",
  "最新版本": "Latest versions",
  "加载版本列表…": "Loading version list…",
  "获取版本列表失败": "Failed to load version list",
  "未能解析当前版本": "Cannot parse current version",
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
  "Claude 官方订阅": "Claude official plan",
  "凭据缺失": "Credential missing",
  "暂不支持该供应商": "Provider not supported yet",
  "{label}窗口 · 已使用 {pct}%": "{label} window · {pct}% used",
  "{base} · 重置于 {at}({relative})": "{base} · resets {at} ({relative})",
  "重置{time} · {relative}": "Resets {time} · {relative}",
  "{m}月{d}日": "{m}/{d}",

  /* 页尾 QUOTA 套餐水位面板(卡片网格) */
  "套餐水位": "plan usage",
  "暂无可查询的套餐额度": "No queryable plan quota",
  "数据源:供应商额度查询 + 会话记录本地推算":
    "Source: provider quota API + local session-log inference",
  "刷新重算": "Recalculate",
  "推算中…": "Recalculating…",
  "最近推算 {time}": "Last calculated {time}",
  "下一个可用窗口:{name}（推算）,{cd}": "Next window: {name} (inferred), {cd}",
  "下一个可用窗口:{name},{cd}": "Next window: {name}, {cd}",
  "全部可推算窗口均已重置": "All inferred windows have reset",
  "倒计时本地每分钟重算,无网络轮询":
    "Countdown recalcs locally every minute — no network polling",
  "已用": "used",
  "{h}小时 {m}分后": "in {h}h {m}m",
  "{m}分后": "in {m}m",
  "窗口起点 {time} · 由本窗口首条用量行推算":
    "Window started {time} · inferred from the first usage line in this window",
  "重置于 {time}": "resets {time}",
  "充裕": "Healthy",
  "已限额": "Limited",
  "可推算": "Inferable",
  "已重置": "Reset",
  "新窗口已开始计数,用量从 0 起算": "New window counting — usage starts from 0",
  "{name} 当前窗口已用 {pct}%": "{name} current window {pct}% used",
  "不猜测": "no guess",
  /* 插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "欢迎页": "Welcome page",
  "无会话首页:引擎全动作行、凭据额度、套餐水位":
    "No-session home: engine action rows, credentials & quota, plan usage",
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
  "版本获取失败": "バージョン取得に失敗",
  "最新版查询失败,点右上刷新按钮重试": "最新版の取得に失敗しました — 右上の更新ボタンで再試行してください",

  /* 引擎卡 */
  "官方文档": "ドキュメント",
  "探针中…": "プローブ中…",
  "已安装": "インストール済み",
  "未安装": "未インストール",
  "探针失败": "プローブ失敗",
  "已是最新": "最新です",
  '当前 {current},最新 {version},点"更新"升级':
    "現在 {current}、最新 {version}。「更新」でアップグレード",
  "更新": "更新",
  "重装": "再インストール",
  "新会话": "新規セッション",
  "更新到 {version}": "{version} に更新",
  "重新安装/更新到最新版": "再インストール/最新版へ更新",
  "重新探针": "再プローブ",
  "版本": "バージョン",
  "安装指定版本(回退/收藏)": "指定バージョンをインストール(ロールバック/お気に入り)",
  "当前版本": "現在のバージョン",
  "当前": "現在",
  "收藏": "お気に入り",
  "收藏该版本": "このバージョンをお気に入りに追加",
  "取消收藏该版本": "このバージョンのお気に入りを解除",
  "最新版本": "最新バージョン",
  "加载版本列表…": "バージョン一覧を読み込み中…",
  "获取版本列表失败": "バージョン一覧の取得に失敗",
  "未能解析当前版本": "現在のバージョンを解析できません",
  "安装": "インストール",
  "先安装 {name}": "先に {name} をインストール",

  /* 前置依赖引导 */
  "探针前置依赖 {name}…": "前提条件 {name} をプローブ中…",
  "前置依赖 {name} 探针失败": "前提条件 {name} のプローブに失敗",
  "依赖 {name} 运行时 —— 先安装 {name},再安装/更新本引擎":
    "{name} ランタイムが必要 —— 先に {name} をインストールしてから本エンジンを導入/更新",
  "{name} 官网": "{name} 公式サイト",
  "{name} 安装": "{name} インストール",
  "正在安装 {name}…": "{name} をインストール中…",
  "安装 {name}": "{name} をインストール",
  "重新探针前置依赖": "前提条件を再プローブ",

  /* 安装日志 */
  "{label}完成": "{label}完了",
  "{label}失败,日志见上方": "{label}失敗。ログは上を参照",

  /* 凭据/额度区 */
  "无已登录供应商": "ログイン済みプロバイダーなし",
  "凭据与额度{arrow}": "認証情報と使用量{arrow}",
  "(点击展开)": "(クリックで展開)",
  "(点击收起)": "(クリックで折りたたみ)",
  "已登录": "ログイン済み",
  "已登录(ChatGPT 订阅)": "ログイン済み(ChatGPT プラン)",
  "已登录;官方订阅额度请在 CLI 内 /usage 查看":
    "ログイン済み。公式プランの使用量は CLI 内 /usage で確認",
  "Claude 官方订阅": "Claude 公式プラン",
  "凭据缺失": "認証情報なし",
  "暂不支持该供应商": "このプロバイダーは未対応",
  "{label}窗口 · 已使用 {pct}%": "{label}ウィンドウ · 使用 {pct}%",
  "{base} · 重置于 {at}({relative})": "{base} · リセット {at}({relative})",
  "重置{time} · {relative}": "リセット {time} · {relative}",
  "{m}月{d}日": "{m}月{d}日",

  /* ページ末尾 QUOTA プラン使用量パネル(カードグリッド) */
  "套餐水位": "プラン使用量",
  "暂无可查询的套餐额度": "照会可能なプラン使用量なし",
  "数据源:供应商额度查询 + 会话记录本地推算":
    "ソース:プロバイダー使用量 API + セッション記録のローカル推算",
  "刷新重算": "再計算",
  "推算中…": "再計算中…",
  "最近推算 {time}": "最終計算 {time}",
  "下一个可用窗口:{name}（推算）,{cd}": "次のウィンドウ:{name}（推算）、{cd}",
  "下一个可用窗口:{name},{cd}": "次のウィンドウ:{name}、{cd}",
  "全部可推算窗口均已重置": "推算対象ウィンドウはすべてリセット済み",
  "倒计时本地每分钟重算,无网络轮询":
    "カウントダウンはローカルで毎分再計算(ネットワークポーリングなし)",
  "已用": "使用",
  "{h}小时 {m}分后": "{h}時間{m}分後",
  "{m}分后": "{m}分後",
  "窗口起点 {time} · 由本窗口首条用量行推算":
    "ウィンドウ開始 {time} · 本ウィンドウ先頭の使用量行から推算",
  "重置于 {time}": "{time} にリセット",
  "充裕": "余裕あり",
  "已限额": "制限中",
  "可推算": "推算可",
  "已重置": "リセット済み",
  "新窗口已开始计数,用量从 0 起算": "新規ウィンドウ計測中 — 使用量は 0 から",
  "{name} 当前窗口已用 {pct}%": "{name} 現在のウィンドウ 使用 {pct}%",
  "不猜测": "推測しない",

  /* 插件 meta(渲染点在市场清单/命令抽屉,主会话包裹) */
  "欢迎页": "ウェルカムページ",
  "无会话首页:引擎全动作行、凭据额度、套餐水位":
    "無セッション時のホーム:エンジン操作行、認証情報と使用量、プラン使用量",
} as Record<string, string>;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
