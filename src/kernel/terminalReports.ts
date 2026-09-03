/**
 * 终端协议回传识别(xterm onData 通道上的"非用户"字节)。
 *
 * TUI 程序开启焦点上报(DECSET 1004)与鼠标上报后,xterm 会把焦点切换、
 * 鼠标移动/滚动/点击,以及 CLI 查询序列的自动应答(CPR/DA/OSC 颜色)经
 * onData 冒出 —— 它们与用户击键同一条通道,却不是对话输入。照走
 * host.writeSession 的首写语义会把"点一下终端/滚一轮"当成用户发起对话,
 * 无对话的历史会话照样点亮呼吸灯。
 *
 * 判定只认"整段即已知回传形态":xterm 按输入事件逐次触发 onData,回传
 * 不会与击键同段;混合段(如粘贴内容恰好含转义序列)按用户输入放行 ——
 * 宁可偶尔多锚定,不可吞掉真实击键。
 * 回传本身必须照常写进 PTY(CLI 正在等这些应答),只是不计入对话语义。
 */

/** 焦点上报(CSI I / CSI O)。注意 SS3 应用光标键(\x1bOA 等)无 CSI 中括号,不会误中。 */
const FOCUS_RE = /^\x1b\[[IO]$/;

/** 鼠标上报:SGR(\x1b[<b;x;yM/m)、urxvt(\x1b[b;x;yM/m)、X10/普通(\x1b[M + 3 字节坐标)。 */
const MOUSE_RE =
  /^(?:\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\d+;\d+;\d+[Mm]|\x1b\[M[\x20-\xff]{3})$/;

/** 查询应答:光标位置(CPR/DECXCPR,尾 R)、Kitty 键盘协议标志应答(\x1b[?n u ——
 *  必须带 ? 前缀;Kitty 协议的用户按键是 CSI 数字u 无 ?,不可误吞)、
 *  设备属性(DA/DA2,尾 c)、状态报告(CSI n)、模式报告(DECRPM,$y)、
 *  OSC 应答(颜色/剪贴板)、DCS 应答(XTVERSION/DECRQSS)。 */
const REPLY_RE =
  /^(?:\x1b\[\??\d+(?:;\d+)*R$|\x1b\[\?\d+u$|\x1b\[[?><\d;]*c$|\x1b\[0?n$|\x1b\[\?\d+;\d+\$y$|\x1b\]\d+;[^\x07\x1b]*(?:\x07|\x1b\\)$|\x1bP[^\x1b]*\x1b\\$)/;

/** 整段均为终端回传时为 true(照常写 PTY,但不锚定对话)。 */
export function isTerminalReport(data: string): boolean {
  return FOCUS_RE.test(data) || MOUSE_RE.test(data) || REPLY_RE.test(data);
}
