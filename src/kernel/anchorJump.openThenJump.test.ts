/**
 * 文本跳转契约测试(anchorJump.ts 的 jumpToText / openThenJumpToText / textNeedle)。
 * 覆盖:needle 构造(与 anchorNeedle 同管线)、jumpToText(无 handle 拒绝)、
 * openThenJumpToText(活会话直跳不打开发路径、tmd id 直认、打开后等 handle 注册、
 * handle 超时 miss、打开失败 miss、打开成功但未命中 opened、活会话未命中 miss)。
 * TerminalHandle 以纯数据 fake 实现;kernel host 以模块 mock 提供。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  jumpToText,
  openThenJumpToText,
  textNeedle,
} from "./anchorJump";
import {
  registerTerminalHandle,
  unregisterTerminalHandle,
  type TerminalHandle,
} from "./terminalHandles";

/* host mock:活会话表与绑定映射可按用例改写;openDiskSession 可断言未被打开发路径。 */
const hostMock = vi.hoisted(() => {
  const state = {
    sessions: [] as { id: string; profileId: string }[],
    cliOf: {} as Record<string, string>,
  };
  return {
    state,
    getSessions: () => state.sessions,
    getCliSessionId: (id: string) => state.cliOf[id],
    openDiskSession: vi.fn(),
  };
});
vi.mock("./host", () => ({ host: hostMock }));

function fakeHandle(lines: string[], rows = 10): { handle: TerminalHandle; scrolls: number[] } {
  const scrolls: number[] = [];
  const handle = {
    lineText: (row: number) => lines[row] ?? "",
    bufferLength: () => lines.length,
    viewportTop: () => 0,
    rows: () => rows,
    scrollToLine: (row: number) => void scrolls.push(row),
    focus: () => {},
    onScroll: () => () => {},
    hasMoreHistory: () => false,
    loadEarlier: async () => {},
  } as unknown as TerminalHandle;
  return { handle, scrolls };
}

const sessionId = "s-openjump";
let current: TerminalHandle | undefined;

beforeEach(() => {
  current = undefined;
  hostMock.state.sessions = [];
  hostMock.state.cliOf = {};
  hostMock.openDiskSession.mockReset();
});

afterEach(() => {
  if (current) unregisterTerminalHandle(sessionId, current);
  vi.useRealTimers();
});

describe("textNeedle", () => {
  it("与 anchorNeedle 同管线:取首段非附件正文、折叠空白", () => {
    expect(textNeedle("\n  @src/foo.ts 请帮我修复\n第二行")).toBe("请帮我修复");
  });

  it("截断到 24 字符;纯附件剥空回退原文首行", () => {
    expect(textNeedle("x".repeat(40))).toHaveLength(24);
    expect(textNeedle("@a.ts @b.ts")).toBe("@a.ts @b.ts");
  });
});

describe("jumpToText", () => {
  it("无注册 handle 返回 false;命中后按留头跳转返回 true", async () => {
    expect(await jumpToText(sessionId, "找不到的文本")).toBe(false);

    const { handle, scrolls } = fakeHandle(["filler", "请帮我修复 build 失败的问题"]);
    current = handle;
    registerTerminalHandle(sessionId, current);
    expect(await jumpToText(sessionId, "@a.log 请帮我修复 build 失败的问题")).toBe(true);
    /* 2 行 buffer、10 行视口:目标行 1,留头钳 0 */
    expect(scrolls).toEqual([0]);
  });
});

describe("openThenJumpToText", () => {
  it("活会话(绑定 cli 身份)直跳返回 jumped,不走 openDiskSession", async () => {
    hostMock.state.sessions = [{ id: "tmd-1", profileId: "omp" }];
    hostMock.state.cliOf["tmd-1"] = "cli-1";
    const { handle } = fakeHandle(["某轮消息的回显行"]);
    current = handle;
    registerTerminalHandle("tmd-1", current);

    const outcome = await openThenJumpToText(
      { profileId: "omp", cwd: "/w", cliSessionId: "cli-1" },
      "某轮消息",
    );
    expect(outcome).toBe("jumped");
    expect(hostMock.openDiskSession).not.toHaveBeenCalled();
  });

  it("活会话但 handle 不在册:落穿打开路径,open 后 jumped", async () => {
    hostMock.state.sessions = [{ id: "tmd-evicted", profileId: "omp" }];
    hostMock.state.cliOf["tmd-evicted"] = "cli-ev";
    /* 不注册 handle,模拟被 tab 条挤除/已关 tab */
    const resumed = fakeHandle(["挤除会话的原文行"]);
    hostMock.openDiskSession.mockImplementation(async () => {
      registerTerminalHandle("tmd-evicted", resumed.handle);
      return { id: "tmd-evicted" };
    });

    const outcome = await openThenJumpToText(
      { profileId: "omp", cwd: "/w", cliSessionId: "cli-ev" },
      "挤除会话的原文行",
    );
    expect(outcome).toBe("jumped");
    expect(hostMock.openDiskSession).toHaveBeenCalledWith("omp", "/w", undefined, "cli-ev");
    unregisterTerminalHandle("tmd-evicted", resumed.handle);
  });

  it("账本身份 = tmd id(未绑定链)时按会话 id 直认", async () => {
    hostMock.state.sessions = [{ id: "tmd-raw", profileId: "omp" }];
    const { handle } = fakeHandle(["阅读轮的原文行"]);
    current = handle;
    registerTerminalHandle("tmd-raw", current);

    expect(
      await openThenJumpToText(
        { profileId: "omp", cwd: "/w", cliSessionId: "tmd-raw" },
        "阅读轮的原文行",
      ),
    ).toBe("jumped");
  });

  it("已关会话:openDiskSession 后等 handle 注册再跳,命中返回 jumped", async () => {
    const resumed = fakeHandle(["恢复后的历史消息行"]);
    hostMock.openDiskSession.mockImplementation(async () => {
      /* 模拟 TerminalView 挂载注册先于等待拍 */
      registerTerminalHandle("resumed-1", resumed.handle);
      return { id: "resumed-1" };
    });

    const outcome = await openThenJumpToText(
      { profileId: "omp", cwd: "/w", cliSessionId: "cli-9" },
      "恢复后的历史消息行",
    );
    expect(outcome).toBe("jumped");
    expect(hostMock.openDiskSession).toHaveBeenCalledWith("omp", "/w", undefined, "cli-9");
  });

  it("打开后 handle 超时未注册返回 miss", async () => {
    vi.useFakeTimers();
    hostMock.openDiskSession.mockResolvedValue({ id: "resumed-2" });
    const pending = openThenJumpToText(
      { profileId: "omp", cwd: "/w", cliSessionId: "cli-8" },
      "随便什么文本",
      { timeoutMs: 60 },
    );
    await vi.advanceTimersByTimeAsync(120);
    expect(await pending).toBe("miss");
  });

  it("openDiskSession 失败返回 miss;workspaceId 原样透传", async () => {
    hostMock.openDiskSession.mockRejectedValue(new Error("spawn fail"));
    expect(
      await openThenJumpToText(
        { profileId: "omp", cwd: "/w", workspaceId: "ws-1", cliSessionId: "cli-7" },
        "文本",
      ),
    ).toBe("miss");
    expect(hostMock.openDiskSession).toHaveBeenCalledWith("omp", "/w", "ws-1", "cli-7");
  });

  it("打开成功但 needle 不在 buffer 返回 opened;活会话未命中返回 miss", async () => {
    const resumed = fakeHandle(["无关输出"]);
    hostMock.openDiskSession.mockImplementation(async () => {
      registerTerminalHandle("resumed-3", resumed.handle);
      return { id: "resumed-3" };
    });
    expect(
      await openThenJumpToText(
        { profileId: "omp", cwd: "/w", cliSessionId: "cli-6" },
        "不存在的消息文本",
      ),
    ).toBe("opened");

    hostMock.state.sessions = [{ id: "tmd-2", profileId: "omp" }];
    hostMock.state.cliOf["tmd-2"] = "cli-5";
    current = resumed.handle;
    registerTerminalHandle("tmd-2", current);
    expect(
      await openThenJumpToText(
        { profileId: "omp", cwd: "/w", cliSessionId: "cli-5" },
        "不存在",
      ),
    ).toBe("miss");
  });
});
