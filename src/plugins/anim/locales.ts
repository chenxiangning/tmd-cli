/**
 * anim 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · anim 域。 */
const MESSAGES_EN = {
  "动画项目": "Animation projects",
  "目录变更约 2 秒内自动刷新": "Auto-refreshes within ~2s of directory changes",
  "还没有动画项目": "No animation projects yet",
  "在 tmd-anim 中新建的项目会出现在这里;也可以现在建一个项目桩,直接开 AI 会话。":
    "Projects created in tmd-anim appear here; you can also create a project stub now and start an AI session right away.",
  "未检测到本机安装 tmd-anim —— 安装后这里会自动列出你的动画项目。":
    "tmd-anim is not installed on this machine — once installed, your animation projects will appear here automatically.",
  "未检测到 tmd-anim": "tmd-anim not found",
  "未找到 tmd-anim 应用或项目目录(~/.tmd-anim/projects)。安装后,这里会自动列出你的动画项目。":
    "tmd-anim app or project directory (~/.tmd-anim/projects) not found. Once installed, your animation projects will appear here automatically.",
  "前往 Releases 下载": "Download from Releases",
  "共 {n} 个项目": "{n} projects",
  "在编辑器中打开": "Open in editor",
  "也可以先建一个项目桩,直接开 AI 会话": "Or create a project stub now and start an AI session right away",
  "获取 tmd-anim": "Get tmd-anim",
  "关联 AI 会话": "Link AI session",
  "协议 schema": "Protocol schema",
  "协议示例": "Protocol example",
  "目标项目": "Target project",
  "初始提示词(启动后以卡片挂入,点卡片可再编辑)": "Initial prompt (attached as a card on start — click the card to edit)",
  "初始提示词": "Initial prompt",
  "提示词随下一条消息一并发出;空输入 = 仅发卡片": "The prompt is sent with your next message; empty input sends just the card",
  "丢弃初始提示词": "Drop initial prompt",
  "启动会话": "Start session",
  "引用文件": "References",
  "移除引用 {label}": "Remove reference {label}",
  "新建项目桩": "New project stub",
  "打开": "Open",
  "AI 会话": "AI session",
  "无效项目": "Invalid project",
  "未检测到 tmd-anim,请先安装": "tmd-anim not found — install it first",
  "打开失败": "Failed to open",
  "项目文件无效,请先在 tmd-anim 中修复": "Project file is invalid — fix it in tmd-anim first",
  "未设置默认引擎,请先在工作台概览选择": "No default engine set — pick one in the workbench overview first",
  "主目录未就绪,请稍后再试": "Home directory not ready — try again shortly",
  "启动 AI 会话失败": "Failed to start AI session",
} as const;

/** ja 词典 · anim 域。 */
const MESSAGES_JA = {
  "动画项目": "アニメーションプロジェクト",
  "目录变更约 2 秒内自动刷新": "ディレクトリ変更を約2秒以内に自動更新",
  "还没有动画项目": "アニメーションプロジェクトはまだありません",
  "在 tmd-anim 中新建的项目会出现在这里;也可以现在建一个项目桩,直接开 AI 会话。":
    "tmd-anim で作成したプロジェクトがここに表示されます。今すぐスタブを作成してAIセッションを開始することもできます。",
  "未检测到本机安装 tmd-anim —— 安装后这里会自动列出你的动画项目。":
    "このマシンに tmd-anim がインストールされていません —— インストール後、アニメーションプロジェクトがここに自動表示されます。",
  "未检测到 tmd-anim": "tmd-anim が見つかりません",
  "未找到 tmd-anim 应用或项目目录(~/.tmd-anim/projects)。安装后,这里会自动列出你的动画项目。":
    "tmd-anim アプリまたはプロジェクトディレクトリ(~/.tmd-anim/projects)が見つかりません。インストール後、アニメーションプロジェクトがここに自動表示されます。",
  "前往 Releases 下载": "Releases からダウンロード",
  "共 {n} 个项目": "全 {n} 件",
  "在编辑器中打开": "エディターで開く",
  "也可以先建一个项目桩,直接开 AI 会话": "先にスタブを作成してAIセッションを開始することもできます",
  "获取 tmd-anim": "tmd-anim を入手",
  "关联 AI 会话": "AIセッションを関連付け",
  "协议 schema": "プロトコル schema",
  "协议示例": "プロトコル例",
  "目标项目": "対象プロジェクト",
  "初始提示词(启动后以卡片挂入,点卡片可再编辑)": "初期プロンプト(起動後にカードとして添付。カードをクリックで編集)",
  "初始提示词": "初期プロンプト",
  "提示词随下一条消息一并发出;空输入 = 仅发卡片": "プロンプトは次のメッセージと一緒に送信。空入力 = カードのみ送信",
  "丢弃初始提示词": "初期プロンプトを破棄",
  "启动会话": "セッションを起動",
  "引用文件": "参照ファイル",
  "移除引用 {label}": "参照を解除 {label}",
  "新建项目桩": "新規プロジェクトスタブ",
  "打开": "開く",
  "AI 会话": "AIセッション",
  "无效项目": "無効なプロジェクト",
  "未检测到 tmd-anim,请先安装": "tmd-anim が見つかりません。先にインストールしてください",
  "打开失败": "開けませんでした",
  "项目文件无效,请先在 tmd-anim 中修复": "プロジェクトファイルが無効です。先に tmd-anim で修復してください",
  "未设置默认引擎,请先在工作台概览选择": "デフォルトエンジンが未設定です。先にワークベンチ概要で選択してください",
  "主目录未就绪,请稍后再试": "ホームディレクトリの準備ができていません。しばらくしてからもう一度お試しください",
  "启动 AI 会话失败": "AIセッションの起動に失敗しました",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
