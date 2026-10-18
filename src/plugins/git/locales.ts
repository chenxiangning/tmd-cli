/**
 * git 域词典(diff 行级批注,插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · git 域。 */
const MESSAGES_EN = {
  "添加批注": "Add note",
  "取消": "Cancel",
  "提交批注": "Submit note",
  "批注内容(Enter 提交,Shift+Enter 换行,Esc 取消)":
    "Note (Enter to submit, Shift+Enter for newline, Esc to cancel)",
  "你": "You",
  "本回合批注 ({n})": "Notes this round ({n})",
  "工作区": "Workspace",
  "还没有批注;在 diff 行悬停点批注钮添加": "No notes yet; hover a diff line and click the note button to add one",
  "行级批注在双栏 diff 下不可用,请切换单栏视图": "Line notes are unavailable in split diff — switch to unified view",
  "撤销已回传标记(重新回传)": "Undo sent mark (send again)",
  "删除批注": "Delete note",
  "已回传": "Sent",
  "没有可回传的批注": "No notes to send back",
  "已回传 · 共 {n} 条": "Sent · {n} notes",
  "回传给 agent({n} 条)": "Send back to agent ({n})",
  "已填入输入框,按 Enter 发送": "Inserted into the input box — press Enter to send",
  "输入框未就绪,打开会话后再回传": "Input box not ready — open a session before sending notes",
} as const;

/** ja 词典 · git 域。 */
const MESSAGES_JA = {
  "添加批注": "批注を追加",
  "取消": "キャンセル",
  "提交批注": "批注を送信",
  "批注内容(Enter 提交,Shift+Enter 换行,Esc 取消)":
    "批注内容(Enter で送信、Shift+Enter で改行、Esc でキャンセル)",
  "你": "あなた",
  "本回合批注 ({n})": "このターンの批注 ({n})",
  "工作区": "ワークスペース",
  "还没有批注;在 diff 行悬停点批注钮添加":
    "批注はまだありません。diff 行にホバーして批注ボタンから追加してください",
  "行级批注在双栏 diff 下不可用,请切换单栏视图":
    "行批注は 2 カラム diff では使えません。1 カラム表示に切り替えてください",
  "撤销已回传标记(重新回传)": "送信済みマークを取り消す(再送信)",
  "删除批注": "批注を削除",
  "已回传": "送信済み",
  "没有可回传的批注": "返送できる批注はありません",
  "已回传 · 共 {n} 条": "送信済み · 全 {n} 件",
  "回传给 agent({n} 条)": "agent に返送({n} 件)",
  "已填入输入框,按 Enter 发送": "入力欄に挿入しました。Enter で送信してください",
  "输入框未就绪,打开会话后再回传": "入力欄の準備が未完了です。セッションを開いてから送信してください",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
