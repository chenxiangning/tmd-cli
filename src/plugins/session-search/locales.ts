/**
 * session-search 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · session-search 域。 */
const MESSAGES_EN = {
  "搜索会话历史…": "Search session history…",
  "搜索本工作区的会话历史(你输入过的内容)…":
    "Search session history in this workspace (things you typed)…",
  "会话历史搜索": "Session history search",
  "索引中 {n}/{total}": "Indexing {n}/{total}",
  "准备中…": "Preparing…",
  "输入关键词,按标题与你的历史输入检索会话":
    "Type to search sessions by title and your past prompts",
  "索引还没扫到,稍候…": "Index hasn't reached it yet, hold on…",
  "无匹配会话": "No matching sessions",
  "Enter 打开 {name} 的历史会话 · Esc 关闭": "Enter to open a session in {name} · Esc to close",
} as const;

/** ja 词典 · session-search 域。 */
const MESSAGES_JA = {
  "搜索会话历史…": "セッション履歴を検索…",
  "搜索本工作区的会话历史(你输入过的内容)…":
    "このワークスペースのセッション履歴(入力した内容)を検索…",
  "会话历史搜索": "セッション履歴検索",
  "索引中 {n}/{total}": "索引中 {n}/{total}",
  "准备中…": "準備中…",
  "输入关键词,按标题与你的历史输入检索会话":
    "キーワードでタイトルと過去の入力からセッションを検索",
  "索引还没扫到,稍候…": "インデックスが未達です,少々お待ち…",
  "无匹配会话": "一致するセッションなし",
  "Enter 打开 {name} 的历史会话 · Esc 关闭": "Enter で {name} の履歴セッションを開く · Esc で閉じる",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
