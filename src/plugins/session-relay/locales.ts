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
  "接力提示词(可编辑,将作为新会话首条消息发出)":
    "Relay prompt (editable; sent as the new session's first message)",
  "接力提示词": "Relay prompt",
  "取消": "Cancel",
  "开新会话中…": "Starting session…",
  "开新会话并发送": "Start session & send",
  "摘要生成中…": "Summarizing…",
  "接力提示词未能送达(目标会话可能已退出),请重试或取消":
    "Relay prompt was not delivered (target session may have exited). Retry or cancel.",
} as const;

/** ja 词典 · session-relay 域。 */
const MESSAGES_JA = {
  "转到其他引擎接力…": "別エンジンへ引き継ぎ…",
  "转到其他引擎接力": "別エンジンへ引き継ぎ",
  "目标引擎": "切り替え先エンジン",
  "接力提示词(可编辑,将作为新会话首条消息发出)":
    "引き継ぎプロンプト(編集可。新セッションの最初のメッセージとして送信)",
  "接力提示词": "引き継ぎプロンプト",
  "取消": "キャンセル",
  "开新会话中…": "セッション開始中…",
  "开新会话并发送": "セッションを開いて送信",
  "摘要生成中…": "要約生成中…",
  "接力提示词未能送达(目标会话可能已退出),请重试或取消":
    "引き継ぎプロンプトを送信できませんでした(切り替え先セッションが終了した可能性)。再試行またはキャンセルしてください。",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
