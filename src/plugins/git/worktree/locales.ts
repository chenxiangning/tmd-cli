/**
 * worktree 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。既有 worktree 词条历史上落在
 * kernel/locales/<lang>/git.ts,本轮新增文案按插件自带词典纪律随插件走。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · worktree 域(插件自带,i18n.registerMessages 注册;zh 恒等无词典)。 */
const MESSAGES_EN = {
  "读取 worktree 列表…": "Loading worktree list…",
  "在新 worktree 中起会话": "Start session in new worktree",
  "目录:{dir}": "Directory: {dir}",
  "新建分支(基于当前 HEAD)": "New branch (off current HEAD)",
  "检出已有分支": "Check out existing branch",
  "分支名(按会话标题预填)": "Branch name (prefilled from session title)",
  "分支名": "Branch name",
  "分支名不能为空": "Branch name cannot be empty",
  "分支名不能含空格": "Branch name cannot contain spaces",
  "分支已存在,将创建 {branch}": "Branch exists, will create {branch}",
  "选择已有分支": "Choose existing branch",
  "选择已有分支…": "Choose existing branch…",
  "主仓 node_modules 存在时以符号链接复用,新树免重装依赖。":
    "If the main repo has node_modules, it is symlinked into the new tree — no reinstall needed.",
  "已创建并起会话": "Worktree created, session started",
  "创建并起会话": "Create & start session",
  "创建中…": "Creating…",
  "取消": "Cancel",
  "磁盘占用(不含 .git)": "Disk usage (excluding .git)",
  "{n} 个会话在此 worktree 中启动": "{n} session(s) started in this worktree",
  "在新 worktree 中起会话…": "Start session in new worktree…",
  "引擎": "Engine",
  "{dir} 不是 git 仓库,无法创建 worktree。": "{dir} is not a git repository — cannot create a worktree.",
  "创建失败,已回滚:{msg}": "Create failed, rolled back: {msg}",
  "创建失败:{msg}(可重试;残留树可在 git 面板 worktree 管理中移除)":
    "Create failed: {msg} (retry; remove leftover tree via git panel worktree manager)",
  "创建失败:{msg}": "Create failed: {msg}",
  "会话已启动,但未记录 worktree 关联:{msg}": "Session started, but worktree association was not recorded: {msg}",
  "没有可检出的分支(已被其他 worktree 占用的分支不可检出)":
    "No branch available for checkout (branches already checked out by another worktree are excluded)",
} as const;

/** ja 词典 · worktree 域。 */
const MESSAGES_JA = {
  "读取 worktree 列表…": "worktree 一覧を読み込み中…",
  "在新 worktree 中起会话": "新しい worktree でセッションを開始",
  "目录:{dir}": "ディレクトリ: {dir}",
  "新建分支(基于当前 HEAD)": "新規ブランチ(現在の HEAD から)",
  "检出已有分支": "既存ブランチをチェックアウト",
  "分支名(按会话标题预填)": "ブランチ名(セッション title から事前入力)",
  "分支名": "ブランチ名",
  "分支名不能为空": "ブランチ名は空にできません",
  "分支名不能含空格": "ブランチ名に空白は使えません",
  "分支已存在,将创建 {branch}": "ブランチ既存、{branch} を作成します",
  "选择已有分支": "既存ブランチを選択",
  "选择已有分支…": "既存ブランチを選択…",
  "主仓 node_modules 存在时以符号链接复用,新树免重装依赖。":
    "メインリポジトリに node_modules がある場合はシンボリックリンクで再利用し、新ツリーでの再インストールを省きます。",
  "已创建并起会话": "worktree を作成しセッションを開始しました",
  "创建并起会话": "作成してセッション開始",
  "创建中…": "作成中…",
  "取消": "キャンセル",
  "磁盘占用(不含 .git)": "ディスク使用量(.git を除く)",
  "{n} 个会话在此 worktree 中启动": "この worktree で {n} 件のセッションを開始",
  "在新 worktree 中起会话…": "新しい worktree でセッションを開始…",
  "引擎": "エンジン",
  "{dir} 不是 git 仓库,无法创建 worktree。": "{dir} は git リポジトリではないため worktree を作成できません。",
  "创建失败,已回滚:{msg}": "作成に失敗し、ロールバックしました:{msg}",
  "创建失败:{msg}(可重试;残留树可在 git 面板 worktree 管理中移除)":
    "作成に失敗:{msg}(再試行可。残骸は git パネルの worktree 管理から削除できます)",
  "创建失败:{msg}": "作成に失敗:{msg}",
  "会话已启动,但未记录 worktree 关联:{msg}": "セッションは開始されましたが、worktree 関連の記録に失敗しました:{msg}",
  "没有可检出的分支(已被其他 worktree 占用的分支不可检出)":
    "チェックアウト可能なブランチがありません(他の worktree が使用中のブランチは除外)",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
