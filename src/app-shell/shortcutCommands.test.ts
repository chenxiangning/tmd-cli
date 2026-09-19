/**
 * shell.* 外壳命令注册总表契约测试(shortcutCommands.ts):
 * 1. 表完整性不变量 —— 注册期即校验(id 唯一由真实注册表 fail fast 兜底):
 *    全部命令 id 唯一、id 以 shell./panel. 前缀、title 非空、run 可调用;
 *    静态键位型须 keybinding 可解析,match 型须带 keybindingLabel;
 *    global 作用域内静态键位两两不冲突。
 * 2. 行为契约 —— ref 桥类命令(toggleLeft/Right、market)挂点缺失安全、挂点命中转发;
 *    goHome 的「会话 ⇄ 首页」往返记忆(会话退出则不误回);
 *    focusSessionN/focusPanelN 的 when/match 守卫与越界穿透;
 *    next/prevTab 循环切换;panel.* 动作路由到激活面板注册槽。
 * 手法:业务依赖全部 vi.mock,注册表用真件(vi.resetModules + 动态 import,
 * 同 shortcuts.override.test.ts 范式)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ShortcutsNs from "@kernel/shortcuts";
import type * as ShortcutCommandsNs from "./shortcutCommands";
import type { ShortcutKeyEvent } from "@kernel/shortcuts";

/* ── 业务依赖 mock(仅调用期消费,注册期零副作用)────────────────── */

const filePanel = vi.hoisted(() => ({
  panels: [] as Array<Record<string, unknown> & { id: string }>,
  mode: "",
  getFilePanels: () => filePanel.panels,
  getFilePanelMode: () => filePanel.mode,
  setFilePanelMode: vi.fn((id: string) => {
    filePanel.mode = id;
  }),
}));
vi.mock("@kernel/filePanel", () => filePanel);

const hostMock = vi.hoisted(() => ({
  activeId: null as string | null,
  sessions: [] as Array<{ id: string }>,
  getActiveSessionId: () => hostMock.activeId,
  getSessions: () => hostMock.sessions,
  setActiveSession: vi.fn((id: string | null) => {
    hostMock.activeId = id;
  }),
}));
vi.mock("@kernel/host", () => ({ host: hostMock }));

vi.mock("@kernel/settings", () => ({ openSettingsPanel: vi.fn() }));

const tabsMock = vi.hoisted(() => ({
  list: [] as Array<{ id: string }>,
  activeId: null as string | null,
  getTabs: () => tabsMock.list,
  getActiveTabId: () => tabsMock.activeId,
  setActiveTab: vi.fn((id: string) => {
    tabsMock.activeId = id;
  }),
  closeTab: vi.fn(),
}));
vi.mock("@kernel/tabs", () => tabsMock);

const maximized = vi.hoisted(() => ({ toggleEditorMaximized: vi.fn() }));
vi.mock("./editorMaximized", () => maximized);

import { openSettingsPanel } from "@kernel/settings";

const openSettings = vi.mocked(openSettingsPanel);

let mod: typeof ShortcutCommandsNs;
let registry: typeof ShortcutsNs;

function keyEvent(key: string, extra?: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return { key, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, ...extra };
}

function cmd(id: string) {
  const c = registry.getCommands().find((x) => x.id === id);
  if (!c) throw new Error(`命令未注册: ${id}`);
  return c;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  filePanel.panels = [];
  filePanel.mode = "";
  hostMock.activeId = null;
  hostMock.sessions = [];
  tabsMock.list = [];
  tabsMock.activeId = null;
  registry = await import("@kernel/shortcuts");
  mod = await import("./shortcutCommands");
});

describe("注册表完整性不变量", () => {
  it("导入模块即完成全部注册,命令表稳定且按 id 字典序", () => {
    const ids = registry.getCommands().map((c) => c.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids).toEqual([
      "panel.newFile", "panel.newFolder", "panel.refresh", "shell.closeTab",
      "shell.focusPanel1", "shell.focusPanel2", "shell.focusPanel3", "shell.focusSessionN",
      "shell.goHome", "shell.nextTab", "shell.openMarket", "shell.openSettings",
      "shell.prevTab", "shell.toggleEditorMaximized", "shell.toggleLeftBar", "shell.toggleRightBar",
    ]);
  });

  it("每条命令:必填字段齐、id 前缀合法、run 可调用", () => {
    for (const c of registry.getCommands()) {
      expect(c.id.startsWith("shell.") || c.id.startsWith("panel.")).toBe(true);
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(typeof c.run).toBe("function");
    }
  });

  it("键位面完备:静态键位型 keybinding 可解析,match 型带展示标签", () => {
    for (const c of registry.getCommands()) {
      if (c.match) {
        expect(c.keybindingLabel).toBeTruthy();
      } else if (c.keybinding) {
        expect(registry.parseKeybinding(c.keybinding)).not.toBeNull();
      }
    }
  });

  it("global 作用域静态键位两两不冲突(match 型不参与)", () => {
    const seen = new Map<string, string>();
    for (const c of registry.getCommands()) {
      if (!c.keybinding || c.match) continue;
      const p = registry.parseKeybinding(c.keybinding)!;
      const sig = `${p.key}|${p.meta}|${p.shift}|${p.alt}`;
      expect(seen.has(sig), `${c.id} 与 ${seen.get(sig)} 键位冲突`).toBe(false);
      seen.set(sig, c.id);
    }
  });

  it("重复注册同 id 被注册表 fail fast 拒绝(契约面成立)", () => {
    expect(() => registry.registerCommand({ id: "shell.openSettings", title: "x", run: () => {} })).toThrow();
    expect(() => registry.removeCommand("shell.openSettings")).not.toThrow();
    expect(registry.getCommands().some((c) => c.id === "shell.openSettings")).toBe(false);
  });
});

describe("ref 桥类命令", () => {
  it("toggleLeftBar/toggleRightBar:挂点缺失安全,挂点命中转发", () => {
    const left = vi.fn();
    const right = vi.fn();
    cmd("shell.toggleLeftBar").run();
    cmd("shell.toggleRightBar").run();
    expect(left).not.toHaveBeenCalled();
    mod.shellBarToggles.left = left;
    mod.shellBarToggles.right = right;
    cmd("shell.toggleLeftBar").run();
    cmd("shell.toggleRightBar").run();
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).toHaveBeenCalledTimes(1);
  });

  it("openMarket:when 随挂点开合,run 转发市场开合函数", () => {
    expect(cmd("shell.openMarket").when!()).toBe(false);
    const toggle = vi.fn();
    mod.shellMarketToggle.current = toggle;
    expect(cmd("shell.openMarket").when!()).toBe(true);
    cmd("shell.openMarket").run();
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("goHome 先收市场层再切换,market 挂点缺失不阻断切换", () => {
    hostMock.activeId = "s1";
    const close = vi.fn();
    mod.shellMarketClose.current = close;
    cmd("shell.goHome").run();
    expect(close).toHaveBeenCalledTimes(1);
    expect(hostMock.activeId).toBeNull();
  });

  it("openSettings 转发 openSettingsPanel", () => {
    cmd("shell.openSettings").run();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
  it("goHome 往返记忆:会话⇄首页;已退出的会话不误回", () => {
    hostMock.activeId = "s1";
    cmd("shell.goHome").run();
    cmd("shell.goHome").run(); // 记住的会话 s1 未在会话表:保持首页不动
    expect(hostMock.setActiveSession).toHaveBeenCalledTimes(1);
    hostMock.sessions = [{ id: "s1" }];
    cmd("shell.goHome").run();
    expect(hostMock.setActiveSession).toHaveBeenLastCalledWith("s1");
  });

  it("closeTab:无激活 tab 时 when 拦下,有则关闭当前 tab", () => {
    expect(cmd("shell.closeTab").when!()).toBe(false);
    tabsMock.list = [{ id: "t1" }];
    tabsMock.activeId = "t1";
    expect(cmd("shell.closeTab").when!()).toBe(true);
    cmd("shell.closeTab").run();
    expect(tabsMock.closeTab).toHaveBeenCalledWith("t1");
  });
});

describe("shell.focusSessionN", () => {
  it("Cmd+1..9 且会话存在才命中;Shift/Alt/无会话/越界序号穿透", () => {
    hostMock.sessions = [{ id: "s1" }, { id: "s2" }];
    const m = cmd("shell.focusSessionN").match!;
    expect(m(keyEvent("1"))).toBe(true);
    expect(m(keyEvent("9"))).toBe(false); // 越过会话数
    expect(m(keyEvent("3"))).toBe(false);
    expect(m(keyEvent("1", { shiftKey: true }))).toBe(false);
    expect(m(keyEvent("1", { altKey: true }))).toBe(false);
    expect(m(keyEvent("a"))).toBe(false);
    expect(m(keyEvent("1", { metaKey: false, ctrlKey: false }))).toBe(false);
  });

  it("run 激活 match 命中的第 N 个会话;从未 match 过时直调按序号 0 守卫", () => {
    hostMock.sessions = [{ id: "s1" }];
    const c = cmd("shell.focusSessionN");
    c.run(); // focusSessionN 尚为 0,守卫按无会话处理,不误切
    expect(hostMock.setActiveSession).not.toHaveBeenCalled();
    hostMock.sessions = [{ id: "s1" }, { id: "s2" }];
    expect(c.match!(keyEvent("2"))).toBe(true);
    c.run();
    expect(hostMock.setActiveSession).toHaveBeenLastCalledWith("s2");
  });
});

describe("focusPanel1..3", () => {
  it("面板数不足时 when 拦下,足够时 run 切到第 N 个面板", () => {
    filePanel.panels = [{ id: "files" }, { id: "git" }];
    expect(cmd("shell.focusPanel3").when!()).toBe(false);
    cmd("shell.focusPanel3").run();
    expect(filePanel.setFilePanelMode).not.toHaveBeenCalled();
    expect(cmd("shell.focusPanel2").when!()).toBe(true);
    cmd("shell.focusPanel2").run();
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("git");
  });
});

describe("tab 顺序切换(next/prev)", () => {
  it("match 语义:(meta||ctrl)+Tab,Shift 区分方向,Alt 排除", () => {
    const next = cmd("shell.nextTab").match!;
    const prev = cmd("shell.prevTab").match!;
    expect(next(keyEvent("Tab"))).toBe(true);
    expect(next(keyEvent("Tab", { metaKey: false, ctrlKey: true }))).toBe(true);
    expect(next(keyEvent("Tab", { shiftKey: true }))).toBe(false);
    expect(prev(keyEvent("Tab", { shiftKey: true }))).toBe(true);
    expect(next(keyEvent("Tab", { altKey: true }))).toBe(false);
    expect(next(keyEvent("t"))).toBe(false);
  });

  it("run 循环切换:末尾下一个回头、首个上一个到尾", () => {
    tabsMock.list = [{ id: "a" }, { id: "b" }, { id: "c" }];
    tabsMock.activeId = "c";
    cmd("shell.nextTab").run();
    expect(tabsMock.setActiveTab).toHaveBeenLastCalledWith("a");
    cmd("shell.prevTab").run();
    expect(tabsMock.setActiveTab).toHaveBeenLastCalledWith("c");
  });

  it("无激活 tab 或单 tab 时 when 拦下且 run 不误切", () => {
    tabsMock.list = [{ id: "a" }];
    expect(cmd("shell.nextTab").when!()).toBe(false);
    tabsMock.activeId = "a";
    cmd("shell.nextTab").run();
    expect(tabsMock.setActiveTab).not.toHaveBeenCalled();
  });
});

describe("shell.toggleEditorMaximized", () => {
  it("match = ⌃⌘F 双修饰键大小写不敏感;无 tab 拦下,有 tab run 转发最大化", () => {
    const c = cmd("shell.toggleEditorMaximized");
    const m = c.match!;
    expect(m(keyEvent("f", { metaKey: true, ctrlKey: true }))).toBe(true);
    expect(m(keyEvent("F", { metaKey: true, ctrlKey: true }))).toBe(true);
    expect(m(keyEvent("f", { metaKey: true, ctrlKey: false }))).toBe(false);
    expect(m(keyEvent("f", { metaKey: true, ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(c.when!()).toBe(false);
    tabsMock.list = [{ id: "a" }];
    expect(c.when!()).toBe(true);
    c.run();
    expect(maximized.toggleEditorMaximized).toHaveBeenCalledTimes(1);
  });
});

describe("panel.* 面板动作", () => {
  it("激活面板提供槽时 when 放行,run 调用对应槽;缺槽拦下", () => {
    filePanel.mode = "files";
    const refresh = vi.fn();
    filePanel.panels = [{ id: "files", refresh, newFile: null }];
    expect(cmd("panel.refresh").when!()).toBe(true);
    cmd("panel.refresh").run();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cmd("panel.newFile").when!()).toBe(false);
    cmd("panel.newFile").run();
    expect(cmd("panel.newFolder").when!()).toBe(false);
  });

  it("激活面板槽缺失时 run 不抛(可选链兜底)", () => {
    filePanel.mode = "files";
    filePanel.panels = [{ id: "files" }];
    expect(() => cmd("panel.refresh").run()).not.toThrow();
  });
});
