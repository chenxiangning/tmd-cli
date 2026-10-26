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
  "该行不在当前视图(已折叠或不在本 diff)": "Row not in current view (folded or not in this diff)",
  "另有 {n} 条工作区暂存批注(无活跃会话时可见)":
    "{n} more in the workspace stash (visible when no session is active)",
  "Stash ({n})": "Stash ({n})",
  "套用": "Apply",
  "弹出": "Pop",
  "丢弃 stash #{n}?": "Drop stash #{n}?",
  "丢弃后不可恢复;如需保留改动请改用「套用」。":
    "This cannot be undone. Use \"Apply\" to keep the stash entry.",
  "已套用 stash #{n}(条目保留)": "Applied stash #{n} (entry kept)",
  "已弹出 stash #{n}": "Popped stash #{n}",
  "已丢弃 stash #{n}": "Dropped stash #{n}",
  "+ stash": "+ Stash",
  "把当前改动存入 stash(消息可选)": "Stash current changes (message optional)",
  "stash 消息(可选),留空 = 默认": "Stash message (optional) — empty = default",
  "存入 stash": "Stash",
  "已创建 stash": "Stash created",
  "工作区干净,没有可暂存的改动": "Working tree clean — nothing to stash",
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
  "该行不在当前视图(已折叠或不在本 diff)":
    "この行は現在のビューにありません(折りたたみ済み、またはこの diff に存在しない)",
  "另有 {n} 条工作区暂存批注(无活跃会话时可见)":
    "ワークスペース一時保管に {n} 件あります(セッション非選択時に表示)",
  "Stash ({n})": "Stash ({n})",
  "套用": "適用",
  "弹出": "ポップ",
  "丢弃 stash #{n}?": "stash #{n} を破棄しますか?",
  "丢弃后不可恢复;如需保留改动请改用「套用」。":
    "破棄すると元に戻せません。変更を残す場合は「適用」を使ってください。",
  "已套用 stash #{n}(条目保留)": "stash #{n} を適用しました(エントリ保持)",
  "已弹出 stash #{n}": "stash #{n} をポップしました",
  "已丢弃 stash #{n}": "stash #{n} を破棄しました",
  "+ stash": "+ Stash",
  "把当前改动存入 stash(消息可选)": "現在の変更を stash に入れる(メッセージ任意)",
  "stash 消息(可选),留空 = 默认": "stash メッセージ(任意)— 空欄でデフォルト",
  "存入 stash": "Stash に入れる",
  "已创建 stash": "stash を作成しました",
  "工作区干净,没有可暂存的改动": "ワークツリーがクリーンで、stash する変更がありません",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
