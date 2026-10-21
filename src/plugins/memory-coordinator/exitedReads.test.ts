/** 退出尾段共享读单测:同键合并为一次供方调用,异键隔离,失败不缓存结果外的重试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.useFakeTimers();

import { exitedReadKey, readUserMessagesOnce, resetExitedReads } from "./exitedReads";
import type { CliUserMessage } from "@kernel/cli";

const msg = (text: string): CliUserMessage[] => [{ text }] as unknown as CliUserMessage[];

beforeEach(() => resetExitedReads());

describe("readUserMessagesOnce", () => {
  it("同键并发只调一次供方,两边同吃结果", async () => {
    const read = vi.fn(async () => msg("tail"));
    const key = exitedReadKey("omp", "/w", "s1");
    const [a, b] = await Promise.all([readUserMessagesOnce(key, read), readUserMessagesOnce(key, read)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(a).toEqual(msg("tail"));
    expect(b).toEqual(msg("tail"));
  });

  it("TTL 过期后重读", async () => {
    const read = vi.fn(async () => msg("tail"));
    const key = exitedReadKey("omp", "/w", "s1");
    await readUserMessagesOnce(key, read);
    vi.advanceTimersByTime(31_000);
    await readUserMessagesOnce(key, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("供方失败 → null(不抛),键在 TTL 内不重试、过期重试", async () => {
    const read = vi.fn(async () => {
      throw new Error("io");
    });
    const key = exitedReadKey("omp", "/w", "s2");
    await expect(readUserMessagesOnce(key, read)).resolves.toBeNull();
    await expect(readUserMessagesOnce(key, read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(31_000);
    await expect(readUserMessagesOnce(key, read)).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("异键隔离:不同会话各自读", async () => {
    const read = vi.fn(async () => msg("t"));
    await readUserMessagesOnce(exitedReadKey("omp", "/w", "a"), read);
    await readUserMessagesOnce(exitedReadKey("omp", "/w", "b"), read);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
