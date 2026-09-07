/**
 * omp/pi 调色板复刻 —— 色值取自 pi dark.json(源码实证,~/code/AI/github/pi/
 * packages/coding-agent/src/modes/interactive/theme/dark.json)。
 * truecolor(xterm.js 支持);toolTitle=text+bold、accent=路径/图案、
 * muted=输出、dim=提示、success/error/warning=语义色。
 */

const RGB = {
  accent: [138, 190, 183], // #8abeb7
  text: [212, 212, 212], // #d4d4d4
  muted: [128, 128, 128], // gray
  dim: [102, 102, 102], // #666666
  success: [181, 189, 104], // #b5bd68
  error: [204, 102, 102], // #cc6666
  warning: [255, 255, 0],
  userBg: [52, 53, 65], // #343541
  toolPendingBg: [40, 40, 50], // #282832
  toolSuccessBg: [40, 50, 40], // #283228
  toolErrorBg: [60, 40, 40], // #3c2828
};

const ESC = "\x1b";

function fg(name, s) {
  const [r, g, b] = RGB[name];
  return `${ESC}[38;2;${r};${g};${b}m${s}${ESC}[39m`;
}

function bg(name, s) {
  const [r, g, b] = RGB[name];
  return `${ESC}[48;2;${r};${g};${b}m${s}${ESC}[49m`;
}

function bold(s) { return `${ESC}[1m${s}${ESC}[22m`; }
function italic(s) { return `${ESC}[3m${s}${ESC}[23m`; }

/** 紧凑 token 数(pi footer.ts formatTokens 逐行同款)。 */
function formatTokens(count) {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

module.exports = { RGB, ESC, fg, bg, bold, italic, formatTokens };
