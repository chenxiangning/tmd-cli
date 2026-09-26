/**
 * notify 域词典(notify 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · notify 域(键 = 中文源串;zh 恒等无词典)。 */
const MESSAGES_EN = {
  "等待确认": "Waiting for approval",
  "「{name}」在等你确认操作": "“{name}” is waiting for your approval",
  "轮次结束": "Turn finished",
  "「{name}」完成了一轮对话": "“{name}” finished a turn",
  "会话退出": "Session exited",
  "「{name}」已退出": "“{name}” has exited",
  "额度预警 · {provider}": "Quota alert · {provider}",
  "{title}:{label} 窗口已用 {pct}%": "{title}: {label} window at {pct}%",
  "系统通知": "System notifications",
  "离开窗口时的桌面级提醒(仅在窗口失焦时发送)。":
    "Desktop notifications while you're away (sent only when the window is unfocused).",
  "通知": "Notifications",
  "Ask 等待确认": "Ask / approval prompts",
  "CLI 弹出提问/权限确认面板时发系统通知,离开窗口也能第一时间知道。":
    "Send a system notification when a CLI shows an ask/permission panel.",
  "会话完成一轮且未被查看时发系统通知。":
    "Notify when a session finishes a turn and you haven't seen it.",
  "CLI 进程退出时发系统通知;高频且常是自己关的,默认关。":
    "Notify when a CLI process exits; chatty and often your own action, off by default.",
  "额度撞墙预警": "Quota limit alert",
  "激活会话供应商每 10 分钟查一次额度,窗口已用百分比达到阈值即发系统通知(同一窗口周期只提醒一次);0 = 关。":
    "Poll the active session's provider every 10 minutes and notify once per window cycle when usage crosses the threshold; 0 = off.",
  "额度预警阈值百分比": "Quota alert threshold percent",
  "开启": "On",
  "关闭": "Off",
} as const;

/** ja 词典 · notify 域。 */
const MESSAGES_JA = {
  "等待确认": "承認待ち",
  "「{name}」在等你确认操作": "「{name}」が承認を待っています",
  "轮次结束": "ターン終了",
  "「{name}」完成了一轮对话": "「{name}」が 1 ターン完了しました",
  "会话退出": "セッション終了",
  "「{name}」已退出": "「{name}」が終了しました",
  "额度预警 · {provider}": "残高警告 · {provider}",
  "{title}:{label} 窗口已用 {pct}%": "{title}:{label} ウィンドウ {pct}% 使用",
  "系统通知": "システム通知",
  "离开窗口时的桌面级提醒(仅在窗口失焦时发送)。":
    "ウィンドウ非フォーカス時のみ送られるデスクトップ通知。",
  "通知": "通知",
  "Ask 等待确认": "Ask 承認待ち",
  "CLI 弹出提问/权限确认面板时发系统通知,离开窗口也能第一时间知道。":
    "CLI が質問/権限パネルを表示したらシステム通知を送ります。",
  "会话完成一轮且未被查看时发系统通知。":
    "セッションがターンを終え未確認のときに通知します。",
  "CLI 进程退出时发系统通知;高频且常是自己关的,默认关。":
    "CLI プロセス終了時に通知。頻度が高く自分で閉じることも多いため既定はオフ。",
  "额度撞墙预警": "残高上限警告",
  "激活会话供应商每 10 分钟查一次额度,窗口已用百分比达到阈值即发系统通知(同一窗口周期只提醒一次);0 = 关。":
    "アクティブセッションのプロバイダーを 10 分ごとに確認し、使用率がしきい値を超えたら通知(同一ウィンドウ周期に 1 度);0 = オフ。",
  "额度预警阈值百分比": "残高警告しきい値(%)",
  "开启": "オン",
  "关闭": "オフ",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
