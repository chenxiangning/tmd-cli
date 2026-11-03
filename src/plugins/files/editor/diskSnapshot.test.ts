import { describe, expect, it, vi } from "vitest";
import { registerRemoteFileSource } from "@kernel/fileSources";
import { readDiskSnapshot } from "./diskSnapshot";

const ipcMock = vi.hoisted(() => ({ fsMtime: vi.fn(), fsReadFile: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

describe("readDiskSnapshot", () => {
  it("远程重读同时返回内容与版本", async () => {
    const unregister = registerRemoteFileSource({
      id: "testr",
      appliesTo: () => false,
      label: () => "test",
      listDir: async () => [],
      fileUri: () => "testr:///a",
      ownsUri: (path) => path.startsWith("testr://"),
      readText: async () => ({ content: "new", version: { mtimeMs: 9, len: 3 } }),
    });
    await expect(readDiskSnapshot("testr:///a")).resolves.toEqual({
      raw: "new",
      mtimeMs: null,
      version: { mtimeMs: 9, len: 3 },
    });
    unregister();
  });

  it("本地重读保持 mtime 基线", async () => {
    ipcMock.fsReadFile.mockResolvedValueOnce("local");
    ipcMock.fsMtime.mockResolvedValue(12);
    await expect(readDiskSnapshot("/a")).resolves.toEqual({ raw: "local", mtimeMs: 12 });
  });
});
