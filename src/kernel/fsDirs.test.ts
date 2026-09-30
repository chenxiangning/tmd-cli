import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    fsCreateDir: vi.fn(async (path: string) => {
      calls.push(path);
    }),
  },
}));

import { ensureDir, ensureParentDir } from "./fsDirs";

describe("fsDirs 逐级建目录", () => {
  afterEach(() => {
    calls.length = 0;
  });

  it("绝对路径从根逐级建,顺序保序", async () => {
    await ensureDir("/Users/me/.tmd-cli/daily");
    expect(calls).toEqual([
      "/Users",
      "/Users/me",
      "/Users/me/.tmd-cli",
      "/Users/me/.tmd-cli/daily",
    ]);
  });

  it("ensureParentDir 只建父链;无父目录为空操作", async () => {
    await ensureParentDir("/a/b/c.txt");
    expect(calls).toEqual(["/a", "/a/b"]);
    await ensureParentDir("file.txt");
    expect(calls).toEqual(["/a", "/a/b"]);
  });
});
