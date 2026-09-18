/**
 * 终端链接注册表行为契约测试。
 * 覆盖:注册/按 id 替换/退订、attachTerminalLinks 聚合(多 provider 命中合并、
 * 越界命中过滤、无命中回调 undefined)、xterm 1 基 range 换算与 activate 回调。
 * Terminal 用最小 fake(只实现 provideLinks 用到的 buffer/getLine/registerLinkProvider)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import type { ILinkProvider } from "@xterm/xterm";

type TerminalLinksModule = typeof import("./terminalLinks");

let mod: TerminalLinksModule;

function fakeTerminal(lines: string[]): { term: Terminal; captured: () => ILinkProvider | undefined } {
  let captured: ILinkProvider | undefined;
  const term = {
    registerLinkProvider(provider: ILinkProvider) {
      captured = provider;
      return { dispose: () => undefined };
    },
    buffer: {
      active: {
        getLine: (y: number) =>
          y >= 0 && y < lines.length
            ? { translateToString: () => lines[y] }
            : undefined,
      },
    },
  } as unknown as Terminal;
  return { term, captured: () => captured };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./terminalLinks");
});

describe("registerTerminalLinkProvider", () => {
  it("同 id 替换、退订移除", () => {
    const open = vi.fn();
    mod.registerTerminalLinkProvider({ id: "p", find: () => [], open });
    const next = mod.registerTerminalLinkProvider({ id: "p", find: () => [{ start: 0, end: 1 }], open });
    expect(mod.terminalLinkProviders()).toHaveLength(1);
    next();
    expect(mod.terminalLinkProviders()).toHaveLength(0);
  });
});

describe("attachTerminalLinks", () => {
  it("命中换算成 xterm 1 基 range,activate 透传 open", () => {
    const open = vi.fn();
    mod.registerTerminalLinkProvider({
      id: "p",
      find: () => [{ start: 4, end: 17 }],
      open,
    });
    const { term, captured } = fakeTerminal(["see src/a.ts:L7-9 here"]);
    mod.attachTerminalLinks(term);
    const cb = vi.fn();
    captured()?.provideLinks(1, cb);
    const links = cb.mock.calls[0][0];
    expect(links).toHaveLength(1);
    expect(links?.[0].range).toEqual({ start: { x: 5, y: 1 }, end: { x: 18, y: 1 } });
    expect(links?.[0].text).toBe("src/a.ts:L7-9");
    links?.[0].activate({ type: "click" } as MouseEvent, links?.[0].text);
    expect(open).toHaveBeenCalledWith({ start: 4, end: 17 }, "see src/a.ts:L7-9 here");
  });

  it("无命中行回调 undefined;越界命中被过滤", () => {
    mod.registerTerminalLinkProvider({ id: "p", find: () => [{ start: 0, end: 999 }], open: vi.fn() });
    const { term, captured } = fakeTerminal(["", "short line"]);
    mod.attachTerminalLinks(term);
    const cb = vi.fn();
    captured()?.provideLinks(1, cb);
    expect(cb.mock.calls[0][0]).toBeUndefined();
    captured()?.provideLinks(2, cb);
    expect(cb.mock.calls[1][0]).toBeUndefined();
  });

  it("多 provider 命中合并进同一行链接集", () => {
    mod.registerTerminalLinkProvider({ id: "a", find: () => [{ start: 0, end: 2 }], open: vi.fn() });
    mod.registerTerminalLinkProvider({ id: "b", find: () => [{ start: 3, end: 5 }], open: vi.fn() });
    const { term, captured } = fakeTerminal(["abcdef"]);
    mod.attachTerminalLinks(term);
    const cb = vi.fn();
    captured()?.provideLinks(1, cb);
    expect(cb.mock.calls[0][0]).toHaveLength(2);
  });
});
