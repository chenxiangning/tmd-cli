/** en 词典 · mobile 域(手机连接 sheet;键 = 中文源串)。 */
export const MESSAGES = {
  "重新配对(扫码)": "Re-pair (scan code)",
  "状态": "Status",
  "通道": "Channel",
  "桌面版本": "Desktop version",
  "读取中…": "Loading…",
  "重连中…": "Reconnecting…",
  "已断开(手动)": "Disconnected (manual)",
  "重试连接": "Retry connection",
  "连接选项": "Connection options",
  "连接已断开 · 正在重连": "Disconnected · reconnecting",
  "已手动断开连接": "You disconnected manually",
  "内网通道要求手机与电脑在同一局域网;外网通道经中继转发,离开局域网后自动可用。":
    "The LAN channel requires the phone and the computer to be on the same local network; the internet channel goes through the relay and works automatically once you leave the LAN.",
  "已手动断开:不会自动重连,点「重新连接」恢复。":
    "Disconnected manually: no auto-reconnect. Tap \"Reconnect\" to resume.",
  "断开=暂停自动重连(如临时省电);桌面撤销或踢除设备需重新扫码配对。":
    "Disconnect pauses auto-reconnect (e.g. to save battery); if the desktop revokes or removes this device, re-pair by scanning the code.",
} as Record<string, string>;
