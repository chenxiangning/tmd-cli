/**
 * 内置终端入口契约:每次独立点击都新建,不解释修饰键;创建在途时单飞。
 * host 注入替身,不触真实 PTY;工作区 cwd 契约由 kernel/shellSessions.test.ts 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@kernel/plugin";
import type { SidebarAction } from "@kernel/sidebarActions";
import { KernelTopics } from "@kernel/events";

const mocks = vi.hoisted(() => ({
  createShellSession: vi.fn(),
  getSessions: vi.fn(),
  getActiveSessionId: vi.fn(),
  setActiveSession: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@kernel/host", () => ({
  host: {
    createShellSession: mocks.createShellSession,
    getSessions: mocks.getSessions,
    getActiveSessionId: mocks.getActiveSessionId,
    setActiveSession: mocks.setActiveSession,
    events: { emit: mocks.emit },
  },
}));

import { terminalPlugin } from "./index";

const anchor = { x: 0, y: 0 };
const plainMods = { altKey: false, metaKey: false, ctrlKey: false };

function terminalAction(): SidebarAction {
  let captured: SidebarAction | undefined;
  terminalPlugin.activate({
    registerSidebarAction: (action: SidebarAction) => {
      captured = action;
    },
  } as unknown as PluginContext);
  if (!captured) throw new Error("activate 未注册终端动作");
  return captured;
}

/** 排空 create → catch → finally 链,确保模块级在途闸已复位。 */
async function flushCreation() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createShellSession.mockResolvedValue({ id: "shell-new" });
  mocks.getSessions.mockReturnValue([]);
  mocks.getActiveSessionId.mockReturnValue(null);
});

describe("terminal 插件入口", () => {
  it("已有 shell 会话时普通点击仍新建,不复用或主动聚焦旧会话", async () => {
    mocks.getSessions.mockReturnValue([{ id: "shell-old", kind: "shell", createdAt: 10 }]);
    terminalAction().onSelect(anchor, plainMods);
    await flushCreation();

    expect(mocks.createShellSession).toHaveBeenCalledTimes(1);
    expect(mocks.createShellSession).toHaveBeenCalledWith();
    expect(mocks.setActiveSession).not.toHaveBeenCalled();
    expect(mocks.getSessions).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledWith(KernelTopics.sessionViewRequested, null);
  });

  it.each([
    ["Alt", { ...plainMods, altKey: true }],
    ["Meta", { ...plainMods, metaKey: true }],
    ["Ctrl", { ...plainMods, ctrlKey: true }],
  ])("%s 点击与普通点击一致,同样新建", async (_name, mods) => {
    terminalAction().onSelect(anchor, mods);
    await flushCreation();

    expect(mocks.createShellSession).toHaveBeenCalledTimes(1);
    expect(mocks.setActiveSession).not.toHaveBeenCalled();
  });

  it("创建在途的重复点击单飞,完成后再次点击再开新会话", async () => {
    let resolveFirst!: (value: { id: string }) => void;
    mocks.createShellSession
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ id: "shell-second" });
    const action = terminalAction();

    action.onSelect(anchor, plainMods);
    action.onSelect(anchor, plainMods);
    expect(mocks.createShellSession).toHaveBeenCalledTimes(1);

    resolveFirst({ id: "shell-first" });
    await flushCreation();
    action.onSelect(anchor, plainMods);
    await flushCreation();
    expect(mocks.createShellSession).toHaveBeenCalledTimes(2);
  });
});
