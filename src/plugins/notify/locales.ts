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
  "离开屏幕也能第一时间知道:桌面通知、应用内提示音与额度预警。":
    "Know the moment something needs you: desktop notifications, in-app sounds, and quota alerts.",
  "通知": "Notifications",
  "桌面通知": "Desktop notifications",
  "窗口失焦时才发系统级通知;回到窗口即静默,不与界面内的红点/标签重复打扰。":
    "OS-level notifications are sent only while the window is unfocused; they go quiet as soon as you return, without duplicating the in-app badges.",
  "Ask 等待确认": "Ask / approval prompts",
  "CLI 弹出提问/权限确认面板时发系统通知,离开窗口也能第一时间知道。":
    "Send a system notification when a CLI shows an ask/permission panel.",
  "会话完成一轮且未被查看时发系统通知。":
    "Notify when a session finishes a turn and you haven't seen it.",
  "CLI 进程退出时发系统通知;高频且常是自己关的,默认关。":
    "Notify when a CLI process exits; chatty and often your own action, off by default.",
  "应用内音效,不受窗口焦点影响;两类音共用下方音量。":
    "In-app sound effects, regardless of window focus; both sounds share the volume below.",
  "额度撞墙预警": "Quota limit alert",
  "供应商额度逼近上限的提前提醒;仅窗口失焦时发送,聚焦时看额度 chip 即可。":
    "Heads-up before a provider's quota runs out; sent only while the window is unfocused — the quota chip covers the focused case.",
  "预警阈值": "Alert threshold",
  "每 10 分钟查一次在跑会话与平铺幕布各供应商的额度(按供应商去重),窗口已用百分比达到阈值即发通知(同一窗口周期只提醒一次);0 = 关。":
    "Poll the providers of running sessions and tiled terminals every 10 minutes (deduped per provider) and notify once per window cycle when usage crosses the threshold; 0 = off.",
  "额度预警阈值百分比": "Quota alert threshold percent",
  "0–100 的整数;清空或非法输入将保持当前值。":
    "An integer between 0 and 100; empty or invalid input keeps the current value.",
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
  "额度预警 · {provider}": "クォータ警告 · {provider}",
  "{title}:{label} 窗口已用 {pct}%": "{title}:{label} ウィンドウ {pct}% 使用",
  "系统通知": "システム通知",
  "离开屏幕也能第一时间知道:桌面通知、应用内提示音与额度预警。":
    "画面を離れてもすぐ分かる:デスクトップ通知・アプリ内通知音・クォータ警告。",
  "通知": "通知",
  "桌面通知": "デスクトップ通知",
  "窗口失焦时才发系统级通知;回到窗口即静默,不与界面内的红点/标签重复打扰。":
    "OS 通知はウィンドウ非フォーカス時のみ送信。戻れば静音になり、アプリ内のバッジ/ラベルと二重に騒がしくしません。",
  "Ask 等待确认": "Ask 承認待ち",
  "CLI 弹出提问/权限确认面板时发系统通知,离开窗口也能第一时间知道。":
    "CLI が質問/権限パネルを表示したらシステム通知を送ります。",
  "会话完成一轮且未被查看时发系统通知。":
    "セッションがターンを終え未確認のときに通知します。",
  "CLI 进程退出时发系统通知;高频且常是自己关的,默认关。":
    "CLI プロセス終了時に通知。頻度が高く自分で閉じることも多いため既定はオフ。",
  "应用内音效,不受窗口焦点影响;两类音共用下方音量。":
    "アプリ内の効果音。ウィンドウフォーカスに左右されず、2 種類の音で下の音量を共用します。",
  "额度撞墙预警": "クォータ上限警告",
  "供应商额度逼近上限的提前提醒;仅窗口失焦时发送,聚焦时看额度 chip 即可。":
    "プロバイダーのクォータ上限が近づいたら事前にお知らせ。非フォーカス時のみ送信し、フォーカス中はクォータチップで確認できます。",
  "预警阈值": "警告しきい値",
  "每 10 分钟查一次在跑会话与平铺幕布各供应商的额度(按供应商去重),窗口已用百分比达到阈值即发通知(同一窗口周期只提醒一次);0 = 关。":
    "稼働中セッションとタイル状ターミナルの各プロバイダーを 10 分ごとに確認(プロバイダー単位で重複排除)し、使用率がしきい値を超えたら通知(同一ウィンドウ周期に 1 度);0 = オフ。",
  "额度预警阈值百分比": "クォータ警告しきい値(%)",
  "0–100 的整数;清空或非法输入将保持当前值。":
    "0–100 の整数。空欄や無効な入力では現在の値を維持します。",
  "开启": "オン",
  "关闭": "オフ",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
