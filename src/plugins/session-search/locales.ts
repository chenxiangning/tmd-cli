/**
 * session-search 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · session-search 域。 */
const MESSAGES_EN = {
  "搜索会话历史…": "Search session history…",
  "按你输入过的内容检索历史会话,支持全部工作区,一键续聊":
    "Search past sessions by what you typed, across all workspaces, and resume",
  "搜索本工作区的会话历史(你输入过的内容)…":
    "Search session history in this workspace (things you typed)…",
  "搜索全部工作区的会话历史(你输入过的内容)…":
    "Search session history in all workspaces (things you typed)…",
  "会话历史搜索": "Session history search",
  "索引中 {n}/{total}": "Indexing {n}/{total}",
  "准备中…": "Preparing…",
  "输入关键词,按标题与你的历史输入检索会话":
    "Type to search sessions by title and your past prompts",
  "索引还没扫到,稍候…": "Index hasn't reached it yet, hold on…",
  "会话列举失败:部分引擎的磁盘会话目录读不到":
    "Failed to list sessions: some engines' session directories are unreadable",
  "此工作区未发现可检索的磁盘会话": "No indexable sessions found in this workspace",
  "已扫 {scanned}/{total} 个会话,无匹配":
    "Scanned {scanned}/{total} sessions, no matches",
  "↑↓ 选择 · Enter 打开 {name} 的历史会话 · Esc 关闭":
    "↑↓ to select · Enter to open a session in {name} · Esc to close",
  "按引擎过滤": "Filter by engine",
  "全部": "All",
  "按时间过滤": "Filter by time",
  "24小时": "24 hours",
  "7天": "7d",
  "30天": "30d",
  "已打开会话(未定位到命中行)": "Session opened (matching line not located)",
  "未定位到命中行": "Couldn't locate the matching line",
  "按作用域过滤": "Filter by scope",
  "本工作区": "This workspace",
  "全部工作区": "All workspaces",
  "全部工作区({n})": "All workspaces ({n})",
  "工作区已移走": "Workspace moved away",
  "工作区已移走,无法跳转": "Workspace moved away; can't jump there",
  "正在扫描 {n}/{total} 个工作区": "Scanning workspace {n}/{total}",
  "全部工作区都没有可检索的磁盘会话": "No indexable sessions in any workspace",
  "已扫 {w}/{wt} 个工作区,无匹配": "Scanned {w}/{wt} workspaces, no matches",
  "{n} 处命中": "{n} matches",
} as const;

/** ja 词典 · session-search 域。 */
const MESSAGES_JA = {
  "搜索会话历史…": "セッション履歴を検索…",
  "按你输入过的内容检索历史会话,支持全部工作区,一键续聊":
    "入力した内容で履歴セッションを検索(すべてのワークスペース対応)して再開",
  "搜索本工作区的会话历史(你输入过的内容)…":
    "このワークスペースのセッション履歴(入力した内容)を検索…",
  "搜索全部工作区的会话历史(你输入过的内容)…":
    "すべてのワークスペースのセッション履歴(入力した内容)を検索…",
  "会话历史搜索": "セッション履歴検索",
  "索引中 {n}/{total}": "索引中 {n}/{total}",
  "准备中…": "準備中…",
  "输入关键词,按标题与你的历史输入检索会话":
    "キーワードでタイトルと過去の入力からセッションを検索",
  "索引还没扫到,稍候…": "インデックスが未達です,少々お待ち…",
  "会话列举失败:部分引擎的磁盘会话目录读不到":
    "セッション列挙失敗:一部エンジンのディスクセッションが読めません",
  "此工作区未发现可检索的磁盘会话": "このワークスペースに検索可能なセッションがありません",
  "已扫 {scanned}/{total} 个会话,无匹配":
    "{scanned}/{total} セッションを走査,一致なし",
  "↑↓ 选择 · Enter 打开 {name} 的历史会话 · Esc 关闭":
    "↑↓ で選択 · Enter で {name} の履歴セッションを開く · Esc で閉じる",
  "按引擎过滤": "エンジンで絞り込み",
  "全部": "すべて",
  "按时间过滤": "期間で絞り込み",
  "24小时": "24時間",
  "7天": "7日",
  "30天": "30日",
  "已打开会话(未定位到命中行)": "セッションを開きました(一致行は見つかりません)",
  "未定位到命中行": "一致行を見つけられませんでした",
  "按作用域过滤": "スコープで絞り込み",
  "本工作区": "このワークスペース",
  "全部工作区": "すべてのワークスペース",
  "全部工作区({n})": "すべてのワークスペース({n})",
  "工作区已移走": "ワークスペースが移動済み",
  "工作区已移走,无法跳转": "ワークスペースが移動済みのためジャンプできません",
  "正在扫描 {n}/{total} 个工作区": "ワークスペースをスキャン中 {n}/{total}",
  "全部工作区都没有可检索的磁盘会话": "どのワークスペースにも検索可能なセッションがありません",
  "已扫 {w}/{wt} 个工作区,无匹配": "{w}/{wt} ワークスペースを走査,一致なし",
  "{n} 处命中": "{n} 件のヒット",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
