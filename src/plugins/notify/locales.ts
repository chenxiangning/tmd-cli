/**
 * notify 域词典(notify 插件自带,i18n.registerMessages 注册)。
 * 键 = 中文源串;zh 恒等无词典。
 */
import { registerMessages } from "@kernel/i18n";

/** en 词典 · notify 域(键 = 中文源串;zh 恒等无词典)。 */
const MESSAGES_EN = {
  "等待确认": "Awaiting confirmation",
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
  "通知中心": "Notification center",
  "通知流水 · {n} 条": "Notification log · {n} entries",
  "暂无通知记录;等待确认/轮次结束/会话退出/额度预警都会记在这里":
    "No notifications yet; approval prompts, finished turns, session exits, and quota alerts all land here.",
  "今日": "today",
  "更早": "Earlier",
  "清空": "Clear",
  "确认清空?": "Confirm clear?",
  "额度类通知不支持会话回跳": "Quota alerts can't jump to a session",
  "回跳并激活该会话": "Jump to and focus this session",
  "免打扰": "Do not disturb",
  "时段内静音桌面通知与 Ask/结束提示音;通知中心流水照常记录,回来照样回看。":
    "Silences desktop notifications and ask/turn-end sounds during the window; the notification log keeps recording either way, so you can catch up afterwards.",
  "启用免打扰窗": "Enable do-not-disturb window",
  "按下方起止时间静音;支持跨夜(如 22:00 至次日 08:00),起 = 止 视为全天静默。":
    "Mutes between the start and end times below; overnight ranges (e.g. 22:00–08:00) work, and equal times mean all day.",
  "开始时间": "Start time",
  "结束时间": "End time",
  "时刻到达即进入静默。": "Silence begins at this time.",
  "到达该时刻即解除(不含);起 = 止 则全天静默。":
    "Silence lifts at this time (exclusive); equal times mean all day.",
  "免打扰开始时间": "Do-not-disturb start time",
  "免打扰结束时间": "Do-not-disturb end time",
  "额度预警": "Quota alert",
  "「{name}」的额度需要关注": "\"{name}\" needs your attention on quota",
  "「{name}」额度窗口约 {mins} 分钟后重置":
    "\"{name}\"'s quota window resets in about {mins} min",
  "{title}:余额 {amount} 已低于下限 {below}":
    "{title}: balance {amount} is below the {below} limit",
  "窗口将撞墙/余额过低/即将重置时发系统通知;通知中心流水不受开关影响,照常记录。":
    "Send a system notification when a window nears its cap, the balance runs low, or a reset is due; the notification log records either way.",
  "余额告警下限": "Balance alert floor",
  "账户余额低于该数值即发通知(货币跟随供应商回包,deepseek/中转站有效);余额型供应商无额度分母,用绝对金额而非百分比;0 = 关。":
    "Notify when the account balance drops below this amount (currency follows the provider response; deepseek/relay only). Balance-type providers have no quota denominator, so an absolute amount is used instead of a percent; 0 = off.",
  "余额告警下限金额": "Balance alert floor amount",
  "非负数值;清空或非法输入将保持当前值。":
    "A non-negative number; empty or invalid input keeps the current value.",
  "重置前提醒": "Reset reminder",
  "claude 5 小时窗口按本地用量行推算,距重置不足该分钟数即提醒一次(5-240;仅官方 OAuth 登录的 claude 有效,其余供应商走真实额度 API)。":
    "claude's 5-hour window is estimated locally from usage lines; notify once when the reset is fewer than these minutes away (5-240; only official OAuth claude, other providers use the real quota API).",
  "窗口重置前提醒分钟数": "Minutes before window reset to remind",
  "5-240 的整数;清空或非法输入将保持当前值。":
    "An integer between 5 and 240; empty or invalid input keeps the current value.",
} as const;

/** ja 词典 · notify 域。 */
const MESSAGES_JA = {
  "等待确认": "確認待ち",
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
  "通知中心": "通知センター",
  "通知流水 · {n} 条": "通知ログ · {n} 件",
  "暂无通知记录;等待确认/轮次结束/会话退出/额度预警都会记在这里":
    "通知はまだありません。承認待ち/ターン終了/セッション終了/クォータ警告がすべてここに記録されます。",
  "今日": "今日",
  "更早": "それ以前",
  "清空": "クリア",
  "确认清空?": "消去しますか?",
  "额度类通知不支持会话回跳": "クォータ警告はセッションへジャンプできません",
  "回跳并激活该会话": "このセッションへジャンプしてアクティブにする",
  "免打扰": "おやすみモード",
  "时段内静音桌面通知与 Ask/结束提示音;通知中心流水照常记录,回来照样回看。":
    "時間帯内はデスクトップ通知と Ask/ターン終了音を消音します。通知ログは通常どおり記録されるので、あとで見返せます。",
  "启用免打扰窗": "おやすみモードを有効化",
  "按下方起止时间静音;支持跨夜(如 22:00 至次日 08:00),起 = 止 视为全天静默。":
    "下の開始・終了時刻の間で消音。日をまたぐ設定(例:22:00〜08:00)に対応し、開始 = 終了は終日消音。",
  "开始时间": "開始時刻",
  "结束时间": "終了時刻",
  "时刻到达即进入静默。": "この時刻に消音を開始。",
  "到达该时刻即解除(不含);起 = 止 则全天静默。":
    "この時刻で解除(時刻自体は含まず)。開始 = 終了は終日消音。",
  "免打扰开始时间": "おやすみモード開始時刻",
  "免打扰结束时间": "おやすみモード終了時刻",
  "额度预警": "クォータ警告",
  "「{name}」的额度需要关注": "「{name}」のクォータに注意が必要です",
  "「{name}」额度窗口约 {mins} 分钟后重置":
    "「{name}」のクォータウィンドウは約 {mins} 分後にリセットされます",
  "{title}:余额 {amount} 已低于下限 {below}":
    "{title}: 残高 {amount} が下限 {below} を下回りました",
  "窗口将撞墙/余额过低/即将重置时发系统通知;通知中心流水不受开关影响,照常记录。":
    "ウィンドウ上限接近・残低下・リセット接近時にシステム通知を送信。通知ログはスイッチに関係なく通常どおり記録されます。",
  "余额告警下限": "残高警告の下限",
  "账户余额低于该数值即发通知(货币跟随供应商回包,deepseek/中转站有效);余额型供应商无额度分母,用绝对金额而非百分比;0 = 关。":
    "残高がこの値を下回ったら通知(通貨はプロバイダーの応答に従い、deepseek/中継のみ有効)。残高型プロバイダーには上限分母がないためパーセントではなく絶対額を使用;0 = オフ。",
  "余额告警下限金额": "残高警告下限の金額",
  "非负数值;清空或非法输入将保持当前值。":
    "0 以上の数値。空欄や無効な入力では現在の値を維持します。",
  "重置前提醒": "リセット前のリマインダー",
  "claude 5 小时窗口按本地用量行推算,距重置不足该分钟数即提醒一次(5-240;仅官方 OAuth 登录的 claude 有效,其余供应商走真实额度 API)。":
    "claude の 5 時間ウィンドウはローカルの使用量行から推定し、リセットまでの残りがこの分数(5-240)を下回ったら 1 度だけ通知(公式 OAuth の claude のみ有効。他プロバイダーは実クォータ API を利用)。",
  "窗口重置前提醒分钟数": "ウィンドウリセット前の通知分数",
  "5-240 的整数;清空或非法输入将保持当前值。":
    "5-240 の整数。空欄や無効な入力では現在の値を維持します。",
} as const;

registerMessages({ en: MESSAGES_EN, ja: MESSAGES_JA });
