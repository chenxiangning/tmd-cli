/**
 * xterm theme 读取 —— 从文档计算样式读终端 token → xterm ITheme。
 * 自 TerminalView 拆出(文件规模铁则);主题引擎在调用前已内联最新 token 值,
 * ANSI 16 色与 bg/fg/cursor/selection 同源 --tmd-terminal-*。
 */

import type { ITheme } from "@xterm/xterm";

export function readTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim() || undefined;
  const ansi = {
    black: read("--tmd-terminal-black"), red: read("--tmd-terminal-red"),
    green: read("--tmd-terminal-green"), yellow: read("--tmd-terminal-yellow"),
    blue: read("--tmd-terminal-blue"), magenta: read("--tmd-terminal-magenta"),
    cyan: read("--tmd-terminal-cyan"), white: read("--tmd-terminal-white"),
    brightBlack: read("--tmd-terminal-bright-black"), brightRed: read("--tmd-terminal-bright-red"),
    brightGreen: read("--tmd-terminal-bright-green"),
    brightYellow: read("--tmd-terminal-bright-yellow"),
    brightBlue: read("--tmd-terminal-bright-blue"),
    brightMagenta: read("--tmd-terminal-bright-magenta"),
    brightCyan: read("--tmd-terminal-bright-cyan"),
    brightWhite: read("--tmd-terminal-bright-white"),
  } as const;
  return {
    background: read("--tmd-terminal-bg"),
    foreground: read("--tmd-terminal-fg"),
    cursor: read("--tmd-terminal-cursor"),
    selectionBackground: read("--tmd-terminal-selection"),
    ...ansi,
  };
}
