/**
 * useMinSpin 计时核回归测试(node 环境直测 createMinSpinCore,不挂 React)。
 * 焦点:① 同步落定仍保底 minMs;② run 同步抛错归一必清忙态;
 * ③ 迟落定的旧 spin 不得杀新点击的停表 timer(2026-10-09 评审 P1:忙态永久卡死);
 * ④ dispose 清 timer。
 * fake timers 下 finish 走微任务:推时一律用 advanceTimersByTimeAsync(逐微任务冲刷)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMinSpinCore } from "./useMinSpin";

describe("createMinSpinCore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("同步落定仍保底 minMs(600ms)", async () => {
    const seen: boolean[] = [];
    const core = createMinSpinCore((v) => seen.push(v));
    core.spin(() => null);
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(599);
    expect(seen).toEqual([true]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual([true, false]);
  });

  it("run 同步抛错归一,忙态必清", async () => {
    const seen: boolean[] = [];
    const core = createMinSpinCore((v) => seen.push(v));
    core.spin(() => {
      throw new Error("boom");
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(seen).toEqual([true, false]);
  });

  it("迟落定的旧 spin 不杀新点击的停表 timer(P1 回归)", async () => {
    const seen: boolean[] = [];
    const core = createMinSpinCore((v) => seen.push(v));
    let resolveA: (v: null) => void = () => {};
    core.spin(() => new Promise<null>((r) => (resolveA = r)));
    await vi.advanceTimersByTimeAsync(500); // A 未落定,无 timer
    core.spin(() => null); // B 同步落定:批次号接管,停表 timer = t=1100
    await vi.advanceTimersByTimeAsync(399); // t=899(B 的 finish 已落 timer)
    resolveA(null); // A 迟落定:旧 finish 必须整体 no-op
    await vi.advanceTimersByTimeAsync(0); // 冲刷 A 的 finish 微任务
    await vi.advanceTimersByTimeAsync(200); // t=1099:B 的窗未满
    expect(seen).toEqual([true, true]); // A/B 各起转一次;A 的迟到落定未触发任何 false
    await vi.advanceTimersByTimeAsync(1); // t=1100:B 窗满,清忙态
    expect(seen).toEqual([true, true, false]);
  });

  it("dispose 清 timer,卸载后不再置忙态", async () => {
    const seen: boolean[] = [];
    const core = createMinSpinCore((v) => seen.push(v));
    core.spin(() => null);
    await vi.advanceTimersByTimeAsync(0); // 冲刷 finish:停表 timer 已落(600ms 后停)
    core.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([true]);
  });
});
