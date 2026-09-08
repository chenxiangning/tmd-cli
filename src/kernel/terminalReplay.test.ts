import { describe, expect, it } from "vitest";
import { writeInChunks } from "./terminalReplay";

/** 假终端:记录写入,回调走微任务模拟 xterm 异步解析。 */
function fakeTerm() {
  const writes: string[] = [];
  return {
    writes,
    write(data: string, cb?: () => void) {
      writes.push(data);
      queueMicrotask(() => cb?.());
    },
  };
}

describe("writeInChunks", () => {
  it("按 128K 分块保序写入,进度逐块推进", async () => {
    const term = fakeTerm();
    const text = "a".repeat(128 * 1024) + "b".repeat(128 * 1024) + "c";
    const progress: Array<[number, number]> = [];
    await writeInChunks(term, text, (done, total) => progress.push([done, total]));
    expect(term.writes.map((w) => w.length)).toEqual([128 * 1024, 128 * 1024, 1]);
    expect(term.writes.join("")).toBe(text);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("空文本零写入直接完成", async () => {
    const term = fakeTerm();
    const progress: Array<[number, number]> = [];
    await writeInChunks(term, "", (done, total) => progress.push([done, total]));
    expect(term.writes).toEqual([]);
    expect(progress).toEqual([[0, 0]]);
  });
});
