/**
 * 幕布历史翻页器行为契约测试(TerminalHistoryPager)。
 * 覆盖:init 锚点反推(日志末尾 - 缓冲字节数)与 hasMore 判定、
 * loadEarlier 翻页(更早页前插、锚点推进到 page.startOffset、hasMore 透传)、
 * 重入闸(loading 期二次调用 no-op)、空页判定 hasMore=false、
 * 整段重写顺序(RIS → 各历史页 → 输出缓冲快照)、输入闸 arm/release 配对、
 * onState 回喂、异常路径仍释放 loading。
 * ipc/host 以 vi.mock fake;Terminal 用最小 write 记录器。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";

const ipcMock = vi.hoisted(() => ({
  sessionLogSize: vi.fn<(id: string) => Promise<number>>(),
  sessionHistoryPage: vi.fn<
    (id: string, off: number, len: number) => Promise<{ text: string; startOffset: number; hasMore: boolean }>
  >(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

const hostMock = vi.hoisted(() => ({
  getOutputBufferBytes: vi.fn<(id: string) => number>(),
  getOutputBuffer: vi.fn<(id: string) => string>(),
}));

vi.mock("@kernel/host", () => ({ host: hostMock }));

import { TerminalHistoryPager } from "./terminalHistory";

function fakeTerminal(): { term: Terminal; writes: string[] } {
  const writes: string[] = [];
  const term = {
    write: (text: string, cb?: () => void) => {
      writes.push(text);
      if (cb) queueMicrotask(cb);
    },
    scrollToTop: vi.fn(),
  } as unknown as Terminal;
  return { term, writes };
}

function newPager() {
  const counts = { armed: 0, released: 0 };
  const gate = { arm: () => void counts.armed++, release: () => void counts.released++ };
  const onState = vi.fn();
  const pager = new TerminalHistoryPager("s1", gate as never, onState);
  return { pager, counts, onState };
}

beforeEach(() => {
  vi.clearAllMocks();
  hostMock.getOutputBuffer.mockReturnValue("SNAP");
});

describe("init 锚点初始化", () => {
  it("锚点 = 日志末尾 - 当前缓冲字节数;有残余历史时 hasMore 为真", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(10_000);
    hostMock.getOutputBufferBytes.mockReturnValue(6_000);
    const { pager, onState } = newPager();
    await pager.init();
    expect(pager.hasMoreHistory()).toBe(true);
    expect(onState).toHaveBeenLastCalledWith(true, false);
  });

  it("缓冲覆盖全量日志时 hasMoreHistory 为假", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(4_000);
    hostMock.getOutputBufferBytes.mockReturnValue(9_000);
    const { pager, onState } = newPager();
    await pager.init();
    expect(pager.hasMoreHistory()).toBe(false);
    expect(onState).toHaveBeenLastCalledWith(false, false);
  });
});

describe("loadEarlier 翻页", () => {
  it("更早的页前插,锚点推进到 startOffset,hasMore 随页透传", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(10_000);
    hostMock.getOutputBufferBytes.mockReturnValue(0);
    const { pager } = newPager();
    await pager.init();

    ipcMock.sessionHistoryPage.mockResolvedValue({ text: "page-2", startOffset: 4_000, hasMore: true });
    await pager.loadEarlier(fakeTerminal().term);
    expect(pager.hasMoreHistory()).toBe(true);

    ipcMock.sessionHistoryPage.mockResolvedValue({ text: "page-1", startOffset: 0, hasMore: false });
    await pager.loadEarlier(fakeTerminal().term);
    expect(pager.hasMoreHistory()).toBe(false);
  });

  it("整段重写顺序:RIS → 各历史页(旧到新)→ 输出缓冲快照,并滚动回顶", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(10_000);
    hostMock.getOutputBufferBytes.mockReturnValue(0);
    const { pager } = newPager();
    await pager.init();

    ipcMock.sessionHistoryPage.mockResolvedValue({ text: "page-2", startOffset: 4_000, hasMore: true });
    await pager.loadEarlier(fakeTerminal().term);
    ipcMock.sessionHistoryPage.mockResolvedValue({ text: "page-1", startOffset: 0, hasMore: false });
    const { term, writes } = fakeTerminal();
    await pager.loadEarlier(term);

    expect(writes[0]).toBe("\x1bc");
    expect(writes.slice(1, -1)).toEqual(["page-1", "page-2"]);
    expect(writes[writes.length - 1]).toBe("SNAP");
    expect(term.scrollToTop).toHaveBeenCalled();
  });

  it("loading 期二次调用被重入闸拦下,只读一页只重写一次", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(9_000);
    hostMock.getOutputBufferBytes.mockReturnValue(0);
    const { pager } = newPager();
    await pager.init();
    const { promise: pending, resolve: releasePage } = Promise.withResolvers<{ text: string; startOffset: number; hasMore: boolean }>();
    ipcMock.sessionHistoryPage.mockReturnValue(pending as never);
    const { term, writes } = fakeTerminal();
    const first = pager.loadEarlier(term);
    const second = pager.loadEarlier(term);
    releasePage({ text: "p", startOffset: 0, hasMore: false });
    await Promise.all([first, second]);
    expect(ipcMock.sessionHistoryPage).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["\x1bc", "p", "SNAP"]);
  });

  it("空页(无更早内容)经 onState 置 hasMore=false 提前返回,不重写幕布", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(9_000);
    hostMock.getOutputBufferBytes.mockReturnValue(0);
    const { pager, onState } = newPager();
    await pager.init();
    ipcMock.sessionHistoryPage.mockResolvedValue({ text: "", startOffset: 0, hasMore: false });
    const { term, writes } = fakeTerminal();
    await pager.loadEarlier(term);
    /* UI 门闸是 onState 回喂的 hasMore;锚点字节仍在(日志确实还有未读),不重写幕布 */
    expect(onState).toHaveBeenLastCalledWith(false, false);
    expect(writes).toEqual([]);
  });

  it("翻页 IPC 抛错时 finally 仍释放 loading 与输入闸,不成对锁死", async () => {
    ipcMock.sessionLogSize.mockResolvedValue(9_000);
    hostMock.getOutputBufferBytes.mockReturnValue(0);
    const { pager, counts, onState } = newPager();
    await pager.init();
    ipcMock.sessionHistoryPage.mockRejectedValue(new Error("boom"));
    const { term } = fakeTerminal();
    await expect(pager.loadEarlier(term)).rejects.toThrow("boom");
    expect(onState).toHaveBeenLastCalledWith(true, false);
    expect(counts.released).toBeGreaterThanOrEqual(counts.armed);
  });
});
