import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPtyFloodHeavy, notePtyBytes, resetPtyFloodForTest } from "./floodGauge";

describe("floodGauge 洪水标尺", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPtyFloodForTest();
  });
  afterEach(() => vi.useRealTimers());

  it("5s 窗内字节过阈值判洪水,停流 5s 后自动退洪", () => {
    /* 4 × 60KB = 240KB < 256KB 阈值:未越线 */
    notePtyBytes(60 * 1024);
    vi.advanceTimersByTime(1_000);
    notePtyBytes(60 * 1024);
    vi.advanceTimersByTime(1_000);
    notePtyBytes(60 * 1024);
    vi.advanceTimersByTime(1_000);
    notePtyBytes(60 * 1024);
    expect(isPtyFloodHeavy()).toBe(false);
    /* 第 5 次喂入累计 300KB 越线:判洪水 */
    vi.advanceTimersByTime(1_000);
    notePtyBytes(60 * 1024);
    expect(isPtyFloodHeavy()).toBe(true);
    /* 停流:heavyUntil = 最后越线时刻 + 5s */
    vi.advanceTimersByTime(5_000);
    expect(isPtyFloodHeavy()).toBe(false);
  });

  it("日常低速(打字/单 tick)不误判", () => {
    for (let i = 0; i < 50; i++) {
      notePtyBytes(1024);
      vi.advanceTimersByTime(100);
    }
    expect(isPtyFloodHeavy()).toBe(false);
  });

  it("间歇洪峰跨桶边界劈开不漏检", () => {
    /* 洪峰两批落 [4s,5s],恰跨翻滚桶边界 [0,5)|[5,10):每桶只装 150KB < 256KB
     * 系统性欠检;真滑动窗下滚动总量 300KB ≥ 256KB 必判洪水。 */
    vi.advanceTimersByTime(4_000);
    notePtyBytes(150 * 1024);
    expect(isPtyFloodHeavy()).toBe(false); /* 单批未越线 */
    vi.advanceTimersByTime(1_000);
    notePtyBytes(150 * 1024);
    expect(isPtyFloodHeavy()).toBe(true); /* 滚动总量越线 */
    vi.advanceTimersByTime(5_100);
    expect(isPtyFloodHeavy()).toBe(false);
  });
});
