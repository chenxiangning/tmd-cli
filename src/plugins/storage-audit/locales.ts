/**
 * 存储管家域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · storage-audit 域。 */
const MESSAGES_EN = {
  "存储体检": "Storage Audit",
  "磁盘占用体检与白名单清理;各家 CLI 会话目录只读零触碰。":
    "Disk usage audit with whitelisted cleanup; CLI session directories are read-only and never touched.",
  "体检与清理": "Audit & Cleanup",
  "开始体检": "Start audit",
  "体检中…": "Auditing…",
  "重新体检": "Re-audit",
  "扫描全部分桶,单类目 20s 超时保护。":
    "Scans every category; per-category 20s timeout guard.",
  "体检失败:{error}": "Audit failed: {error}",
  "类目": "Category",
  "体积": "Size",
  "文件数": "Files",
  "超时": "timed out",
  "未使用": "Unused",
  "CLI 会话目录,只读零触碰": "CLI session directory — read-only, never touched",
  "恢复点数据,可按工作区清理(见下方清理)":
    "Checkpoint data — cleanable per workspace (see cleanup below)",
  "工作台生成文档,可清已归档版本(见下方清理)":
    "Workbench generated docs — archived versions cleanable (see cleanup below)",
  "checkpoints 按工作区": "Checkpoints by workspace",
  "对有快照的工作区执行「保留最近 {keep} 个批次且不超过 {days} 天」;账本 rewrite + 清孤儿对象,不可恢复。":
    "keep the latest {keep} batches and at most {days} days; ledger rewrite + orphan object purge. Irreversible.",
  "加载失败:{error}": "Failed to load: {error}",
  "读取中…": "Loading…",
  "当前没有工作区存在快照数据。": "No workspace has checkpoint snapshots yet.",
  "{n} 文件": "{n} files",
  "已清理 {n} 条": "Pruned {n} entries",
  "确认清理": "Confirm cleanup",
  "清理中…": "Cleaning…",
  "取消": "Cancel",
  "清理到最近 {keep} 个/{days} 天": "Keep latest {keep} / {days} days",
  "已归档文档(docgen)": "Archived docs (docgen)",
  "删除 docs/<entryId>/ 全部版本并移除索引条目,不可恢复;生成中的文档不在此列。":
    "Deletes all versions under docs/<entryId>/ and removes the index entry. Irreversible; in-flight docs are not listed.",
  "操作失败:{error}": "Operation failed: {error}",
  "没有已归档文档。": "No archived docs.",
  "{n} 个版本": "{n} versions",
  "删除": "Delete",
  "删除中…": "Deleting…",
  "删除这份已归档文档?": "Delete this archived doc?",
  "将删除 docs/{id}/ 下全部版本文件与该索引条目,不可恢复。":
    "All version files under docs/{id}/ and its index entry will be deleted. Irreversible.",
  "确认删除": "Confirm delete",
} as const;

/** ja 词典 · storage-audit 域。 */
const MESSAGES_JA = {
  "存储体检": "ストレージ診断",
  "磁盘占用体检与白名单清理;各家 CLI 会话目录只读零触碰。":
    "ディスク使用量の診断とホワイトリスト方式のクリーンアップ。各 CLI のセッションディレクトリは読み取り専用で触れません。",
  "体检与清理": "診断とクリーンアップ",
  "开始体检": "診断開始",
  "体检中…": "診断中…",
  "重新体检": "再診断",
  "扫描全部分桶,单类目 20s 超时保护。":
    "全カテゴリを走査。カテゴリごとに 20 秒のタイムアウト保護。",
  "体检失败:{error}": "診断に失敗しました:{error}",
  "类目": "カテゴリ",
  "体积": "サイズ",
  "文件数": "ファイル数",
  "超时": "タイムアウト",
  "未使用": "未使用",
  "CLI 会话目录,只读零触碰": "CLI セッションディレクトリ:読み取り専用、一切触れません",
  "恢复点数据,可按工作区清理(见下方清理)":
    "チェックポイントデータ。ワークスペース単位でクリーンアップ可能(下記参照)",
  "工作台生成文档,可清已归档版本(见下方清理)":
    "ワークベンチ生成ドキュメント。アーカイブ版をクリーンアップ可能(下記参照)",
  "checkpoints 按工作区": "ワークスペース別チェックポイント",
  "对有快照的工作区执行「保留最近 {keep} 个批次且不超过 {days} 天」;账本 rewrite + 清孤儿对象,不可恢复。":
    "スナップショットがあるワークスペースに対し「直近 {keep} バッチかつ {days} 日以内」を保持。台帳書き直し + 孤児オブジェクト削除。取り消せません。",
  "加载失败:{error}": "読み込みに失敗:{error}",
  "读取中…": "読み込み中…",
  "当前没有工作区存在快照数据。": "スナップショットを持つワークスペースはありません。",
  "{n} 文件": "{n} ファイル",
  "已清理 {n} 条": "{n} 件をクリーンアップ",
  "确认清理": "クリーンアップ確認",
  "清理中…": "クリーンアップ中…",
  "取消": "キャンセル",
  "清理到最近 {keep} 个/{days} 天": "直近 {keep} 件 / {days} 日を保持",
  "已归档文档(docgen)": "アーカイブ済みドキュメント(docgen)",
  "删除 docs/<entryId>/ 全部版本并移除索引条目,不可恢复;生成中的文档不在此列。":
    "docs/<entryId>/ の全バージョンと索引エントリを削除します。取り消せません。生成中のドキュメントは表示されません。",
  "操作失败:{error}": "操作に失敗しました:{error}",
  "没有已归档文档。": "アーカイブ済みドキュメントはありません。",
  "{n} 个版本": "{n} バージョン",
  "删除": "削除",
  "删除中…": "削除中…",
  "删除这份已归档文档?": "このアーカイブ済みドキュメントを削除しますか?",
  "将删除 docs/{id}/ 下全部版本文件与该索引条目,不可恢复。":
    "docs/{id}/ の全バージョンファイルと索引エントリを削除します。取り消せません。",
  "确认删除": "削除を確認",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
