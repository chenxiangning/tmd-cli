/**
 * session-relay 域词典(插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · session-relay 域。 */
const MESSAGES_EN = {
  "转到其他引擎接力…": "Relay to another engine…",
  "转到其他引擎接力": "Relay to another engine",
  "目标引擎": "Target engine",
  "接力提示词(可编辑,将挂到新会话输入框)":
    "Relay prompt (editable; attached to the new session's composer)",
  "接力提示词": "Relay prompt",
  "取消": "Cancel",
  "丢弃": "Discard",
  "开新会话中…": "Starting session…",
  "开新会话并挂摘要": "Start session & attach summary",
  "更新摘要": "Update summary",
  "摘要生成中…": "Summarizing…",
  "接力摘要": "Relay summary",
  "{engine} · {n} 字": "{engine} · {n} chars",
  "丢弃接力摘要": "Discard relay summary",
  "已截断(超摘要预算)": "Truncated (over summary budget)",
  "重试上一回合…": "Retry previous turn…",
  "重试上一回合": "Retry previous turn",
  "重试历史回合": "Retry a previous turn",
  "选择重试回合": "Choose a turn to retry",
  "回合 #{index}": "Turn #{index}",
  "目标会话:{title} · {engine}": "Target session: {title} · {engine}",
  "读取上一回合…": "Reading previous turn…",
  "没有可重试的用户消息": "No user message available to retry",
  "上一回合原文": "Previous turn text",
  "对应 checkpoint 批次 #{index}": "Checkpoint batch #{index}",
  "批次 #{index}": "Batch #{index}",
  "回填到输入框": "Fill composer",
  "回填中…": "Filling composer…",
  "关闭": "Close",
  "会话尚未落盘,无法重试": "Session is not on disk yet; cannot retry",
  "输入框尚未就绪,请稍后重试": "Composer is not ready yet; try again shortly",
} as const;

/** ja 词典 · session-relay 域。 */
const MESSAGES_JA = {
  "转到其他引擎接力…": "別エンジンへ引き継ぎ…",
  "转到其他引擎接力": "別エンジンへ引き継ぎ",
  "目标引擎": "ターゲットエンジン",
  "接力提示词(可编辑,将挂到新会话输入框)":
    "引き継ぎプロンプト(編集可。新セッションの入力欄に取り付けます)",
  "接力提示词": "引き継ぎプロンプト",
  "取消": "キャンセル",
  "丢弃": "破棄",
  "开新会话中…": "セッション開始中…",
  "开新会话并挂摘要": "セッションを開いて要約を取り付け",
  "更新摘要": "要約を更新",
  "摘要生成中…": "要約生成中…",
  "接力摘要": "引き継ぎ要約",
  "{engine} · {n} 字": "{engine} · {n} 字",
  "丢弃接力摘要": "引き継ぎ要約を破棄",
  "已截断(超摘要预算)": "切り詰め済み(サマリー予算超過)",
  "重试上一回合…": "前のターンを再試行…",
  "重试上一回合": "前のターンを再試行",
  "重试历史回合": "履歴のターンを再試行",
  "选择重试回合": "再試行するターンを選択",
  "回合 #{index}": "ターン #{index}",
  "目标会话:{title} · {engine}": "対象セッション:{title} · {engine}",
  "读取上一回合…": "前のターンを読み込み中…",
  "没有可重试的用户消息": "再試行できるユーザーメッセージがありません",
  "上一回合原文": "前のターンの原文",
  "对应 checkpoint 批次 #{index}": "対応する checkpoint バッチ #{index}",
  "批次 #{index}": "バッチ #{index}",
  "回填到输入框": "入力欄に戻す",
  "回填中…": "入力欄に戻しています…",
  "关闭": "閉じる",
  "会话尚未落盘,无法重试": "セッションがまだディスクに保存されていないため再試行できません",
  "输入框尚未就绪,请稍后重试": "入力欄の準備ができていません。しばらくしてから再試行してください",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
