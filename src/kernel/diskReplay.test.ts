/** diskReplay 单槽语义(评审 F2):标签匹配消费、新预取覆盖、消费不删、IPC 失败静默。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  sessionDiskTail: vi.fn(),
}));

vi.mock("./ipc", () => ({ ipc: { sessionDiskTail: hoisted.sessionDiskTail } }));

import { consumeDiskTail, prefetchDiskTail, resetDiskReplayForTest } from "./diskReplay";

const PAGE = (text: string) => ({ text, startOffset: 0, hasMore: false });

describe("diskReplay 单槽预取", () => {
  beforeEach(() => {
    resetDiskReplayForTest();
    hoisted.sessionDiskTail.mockReset();
  });

  it("标签匹配可消费;错配/未预取/未绑定返回 null", () => {
    hoisted.sessionDiskTail.mockReturnValue(Promise.resolve(PAGE("t")));
    prefetchDiskTail("p", "/w", "cli-1");
    expect(consumeDiskTail("cli-2")).toBeNull();
    expect(consumeDiskTail(undefined)).toBeNull();
    expect(consumeDiskTail("cli-1")).not.toBeNull();
  });

  it("未预取直接消费返回 null", () => {
    expect(consumeDiskTail("cli-1")).toBeNull();
  });

  it("新预取覆盖旧槽:旧标签失效,新标签命中", () => {
    hoisted.sessionDiskTail.mockReturnValue(Promise.resolve(PAGE("t")));
    prefetchDiskTail("p", "/w", "cli-1");
    prefetchDiskTail("p", "/w", "cli-2");
    expect(consumeDiskTail("cli-1")).toBeNull();
    expect(consumeDiskTail("cli-2")).not.toBeNull();
  });

  it("消费不删槽:二次消费仍命中(StrictMode 双挂载)", () => {
    hoisted.sessionDiskTail.mockReturnValue(Promise.resolve(PAGE("t")));
    prefetchDiskTail("p", "/w", "cli-1");
    expect(consumeDiskTail("cli-1")).not.toBeNull();
    expect(consumeDiskTail("cli-1")).not.toBeNull();
  });

  it("IPC 失败静默:预取 promise 解析为 null 尾(挂载侧回落现状路径)", async () => {
    hoisted.sessionDiskTail.mockReturnValue(Promise.reject(new Error("boom")));
    prefetchDiskTail("p", "/w", "cli-1");
    await expect(consumeDiskTail("cli-1")).resolves.toBeNull();
  });
});
