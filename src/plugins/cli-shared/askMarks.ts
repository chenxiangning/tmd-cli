/**
 * pi-tui 系 CLI(omp / pi / kimi,输入编辑器与 TUI 框架同源,见 cli-omp 注释)
 * 的 Ask/确认问答卡片标记 —— CliProfile.askMarks 的共享声明。
 *
 * 选词(全部落在面板尾部,问项再长也不会被推出页脚窗口):
 * - `Ask N questions?`:Ask 面板标题行;
 * - `Enter select` / `Esc cancel`:交互选择页脚提示(含 "Enter select · n note
 *   · ↑/↓ move · Tab/←/→ · Esc cancel" 整行变体);
 * - `Other (type your own)`:ask 工具的自定义选项尾行(实测漏报根因:长选项
 *   把 "Ask N questions" 头部推出尾窗,只有底部字面量稳定落在页脚窗口)。
 *
 * 纪律:宁可漏报不可误报;新增字面量必须取自真实 session 日志,禁止猜测。
 */
export const PI_TUI_ASK_MARKS: RegExp[] = [
  /Ask \d+ questions?/,
  /Enter select\b/,
  /Esc(?: to)? cancel\b/,
  /Other \(type your own\)/,
];
