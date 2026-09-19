/**
 * pi-tui 系 CLI(omp / pi / kimi,输入编辑器与 TUI 框架同源,见 cli-omp 注释)
 * 的用户消息回显行标记 —— CliProfile.echoMarks 的共享声明(readopt 重锚
 * 证据,契约见 kernel/cliProfile.ts)。
 *
 * 用户消息框 = 引号灰斜体行:SGR 斜体序列(ESC[3;…m)起 + 字面双引号
 * (2026-09-15 omp 实采,空闲日志零误现)。匹配面是未剥 ANSI 的原始磁盘
 * 日志尾 —— 证据恰在斜体 SGR 上,禁止改造成剥壳后匹配。
 *
 * 先例声明:与 askMarks.ts 同族(pi-tui 共享静态表,omp/pi/kimi 三插件消费)。
 * 纪律:宁可漏报不可误报;字面量必须取自真实 session 日志,禁止猜测。
 */
export const PI_TUI_ECHO_MARKS: RegExp[] = [/\u001b\[3;(?:\d+;)*\d+m"/];
