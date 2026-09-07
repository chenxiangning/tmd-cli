/**
 * DSH 输出门面 —— 默认裸 stdout;adapter 启动时 install(stream) 把内容写入
 * 路由到底栏所有权件(dsh-stream),杜绝与 spinner 抢行。所有模块仍
 * `require("./dsh-print.cjs")` 零改动即受益。
 */

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", white: "\x1b[37m", bgYellow: "\x1b[43m",
};

/* 默认实现:裸 stdout(管道冒烟 / 未 install 时)。 */
let impl = {
  print: (m) => process.stdout.write(m + "\n"),
  nl: () => process.stdout.write("\n"),
  write: (s) => process.stdout.write(s),
  columns: () => process.stdout.columns || 100,
};

module.exports = {
  /** adapter 注入 stream(内容写入转底栏所有权)。 */
  install(s) { impl = s; },
  print(msg) { impl.print(msg); },
  write(s) { impl.write(s); },
  columns() { return impl.columns(); },
  status(msg) { impl.print(`${C.cyan}[DSH]${C.reset} ${msg}`); },
  error(msg) { impl.print(`${C.red}[错误]${C.reset} ${msg}`); },
  nl() { impl.nl(); },
};
