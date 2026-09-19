/**
 * terminalXtermTheme 契约(readTerminalTheme):
 * 从 documentElement 计算样式读 --tmd-terminal-* 全部 22 个 token,值 trim 后
 * 映射到 xterm ITheme 对应键(bg/fg/cursor/selectionBackground + ANSI 16 色);
 * 缺失或空白 token 映射为 undefined,而非空串。
 * document/getComputedStyle 以最小桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTerminalTheme } from "./terminalXtermTheme";

const vars = vi.hoisted(() => ({ map: {} as Record<string, string> }));

beforeEach(() => {
  vars.map = {};
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => vars.map[name] ?? "",
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readTerminalTheme", () => {
  it("22 个终端 token 全量映射到 ITheme 对应键,值 trim", () => {
    vars.map = {
      "--tmd-terminal-bg": " #101010 ",
      "--tmd-terminal-fg": "#eeeeee",
      "--tmd-terminal-cursor": "#00ff00",
      "--tmd-terminal-selection": "#333333",
      "--tmd-terminal-black": "#000000",
      "--tmd-terminal-red": "#ff0000",
      "--tmd-terminal-green": "#00ff00",
      "--tmd-terminal-yellow": "#ffff00",
      "--tmd-terminal-blue": "#0000ff",
      "--tmd-terminal-magenta": "#ff00ff",
      "--tmd-terminal-cyan": "#00ffff",
      "--tmd-terminal-white": "#ffffff",
      "--tmd-terminal-bright-black": "#444444",
      "--tmd-terminal-bright-red": "#ff6666",
      "--tmd-terminal-bright-green": "#66ff66",
      "--tmd-terminal-bright-yellow": "#ffff66",
      "--tmd-terminal-bright-blue": "#6666ff",
      "--tmd-terminal-bright-magenta": "#ff66ff",
      "--tmd-terminal-bright-cyan": "#66ffff",
      "--tmd-terminal-bright-white": "#ffffff",
    };
    expect(readTerminalTheme()).toEqual({
      background: "#101010",
      foreground: "#eeeeee",
      cursor: "#00ff00",
      selectionBackground: "#333333",
      black: "#000000",
      red: "#ff0000",
      green: "#00ff00",
      yellow: "#ffff00",
      blue: "#0000ff",
      magenta: "#ff00ff",
      cyan: "#00ffff",
      white: "#ffffff",
      brightBlack: "#444444",
      brightRed: "#ff6666",
      brightGreen: "#66ff66",
      brightYellow: "#ffff66",
      brightBlue: "#6666ff",
      brightMagenta: "#ff66ff",
      brightCyan: "#66ffff",
      brightWhite: "#ffffff",
    });
  });

  it("缺失或空白 token 映射为 undefined 而非空串", () => {
    vars.map = { "--tmd-terminal-bg": "   ", "--tmd-terminal-fg": "#ffffff" };
    const theme = readTerminalTheme();
    expect(theme.background).toBeUndefined();
    expect(theme.foreground).toBe("#ffffff");
    expect(theme.cursor).toBeUndefined();
    expect(theme.selectionBackground).toBeUndefined();
    expect(theme.black).toBeUndefined();
    expect(theme.brightWhite).toBeUndefined();
  });
});
