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
} as const;

/** ja 词典 · session-relay 域。 */
const MESSAGES_JA = {
  "转到其他引擎接力…": "別エンジンへ引き継ぎ…",
  "转到其他引擎接力": "別エンジンへ引き継ぎ",
  "目标引擎": "切り替え先エンジン",
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
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
