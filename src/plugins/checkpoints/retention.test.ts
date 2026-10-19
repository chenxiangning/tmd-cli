/**
 * retention(保留策略 + 强退恢复收口)契约测试。模块级单例,
 * vi.resetModules + 动态 import 取全新实例(与 store.test 同构)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  checkpointPrune: vi.fn(),
  checkpointSealDead: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type RetentionModule = typeof import("./retention");

let retention: RetentionModule;

const CWD = "/repo";

beforeEach(async () => {
  vi.resetModules();
  retention = await import("./retention");
  vi.clearAllMocks();
});

describe("sealDeadTurns(强退恢复)", () => {
  it("按 cwd 携带宽限触发一次;同 cwd 不重复;失败移除标记允许重收", async () => {
    ipcMock.checkpointSealDead.mockResolvedValue(2);
    await retention.sealDeadTurns(CWD);

    expect(ipcMock.checkpointSealDead).toHaveBeenCalledWith(CWD, 60_000);
    await retention.sealDeadTurns(CWD);
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(1);

    /* 失败:标记回退,下次再收(重试语义与 pruneRetention 一致) */
    ipcMock.checkpointSealDead.mockRejectedValue("E_IO: boom");
    await retention.sealDeadTurns("/other");
    await retention.sealDeadTurns("/other");
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(3);

    ipcMock.checkpointSealDead.mockResolvedValue(0);
    await retention.sealDeadTurns("/other");
    expect(ipcMock.checkpointSealDead).toHaveBeenCalledTimes(4);
  });

  it("空 cwd 短路,不发起 IPC", async () => {
    await retention.sealDeadTurns("");
    expect(ipcMock.checkpointSealDead).not.toHaveBeenCalled();
  });
});

describe("pruneRetention(保留策略)", () => {
  it("按 cwd 100/30 触发一次;失败移除标记允许重试", async () => {
    ipcMock.checkpointPrune.mockResolvedValue(3);
    retention.pruneRetention(CWD);
    await Promise.resolve();
    expect(ipcMock.checkpointPrune).toHaveBeenCalledWith(CWD, 100, 30);

    retention.pruneRetention(CWD);
    expect(ipcMock.checkpointPrune).toHaveBeenCalledTimes(1);

    ipcMock.checkpointPrune.mockRejectedValue("E_IO: boom");
    retention.pruneRetention("/other");
    await Promise.resolve();
    await Promise.resolve();
    retention.pruneRetention("/other");
    expect(ipcMock.checkpointPrune).toHaveBeenCalledTimes(3);
  });
});
