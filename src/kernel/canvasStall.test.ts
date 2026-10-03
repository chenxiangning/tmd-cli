/**
 * 幕布数据链停滞探针(canvasStall)契约测试 —— 判据纯函数的边界:
 * - 仅激活 + 流就绪的幕布受检;
 * - 全局渲染冻结(rAF 停跳)退出(守望阶梯领地,重建无意义);
 * - 重建冷却 30s 内不连环放大;
 * - PTY 静默(缓冲字节无变化)不判 —— 没有「应到未到」的对照;
 * - PTY 在流而幕布超静默窗 = 停滞实锤,触发重建。
 */
import { describe, expect, it } from "vitest";
import {
  shouldRebuildCanvas,
  STALL_CANVAS_SILENCE_MS,
  STALL_RAF_DEAD_MS,
} from "./canvasStall";

const T0 = 1_000_000;

/** 基线:一切健康(流就绪、rAF 跳、PTY 静默且幕布同拍静默)。 */
function base(over: Partial<Parameters<typeof shouldRebuildCanvas>[0]> = {}) {
  return {
    now: T0,
    active: true,
    streamReady: true,
    outputGrew: false,
    lastLiveAt: 0,
    rafGapMs: 16,
    lastKickAt: 0,
    ...over,
  };
}

describe("幕布数据链停滞探针(shouldRebuildCanvas)", () => {
  it("停滞实锤:PTY 缓冲字节在推进,幕布 6s 未收字节 → 重建", () => {
    expect(
      shouldRebuildCanvas(base({ outputGrew: true, lastLiveAt: T0 - STALL_CANVAS_SILENCE_MS })),
    ).toBe(true);
    /* 恰在静默窗边界外 1ms */
    expect(
      shouldRebuildCanvas(base({ outputGrew: true, lastLiveAt: T0 - STALL_CANVAS_SILENCE_MS + 1 })),
    ).toBe(false);
  });

  it("非激活或流未就绪不检(回放/遮罩期的攒队是编排,不是停滞)", () => {
    const stale = { outputGrew: true, lastLiveAt: 0 };
    expect(shouldRebuildCanvas(base({ ...stale, active: false }))).toBe(false);
    expect(shouldRebuildCanvas(base({ ...stale, streamReady: false }))).toBe(false);
  });

  it("全局渲染冻结退出:rAF 间隙超线 = 守望阶梯领地,重建无意义", () => {
    expect(
      shouldRebuildCanvas(base({ outputGrew: true, lastLiveAt: 0, rafGapMs: STALL_RAF_DEAD_MS })),
    ).toBe(false);
  });

  it("重建冷却:30s 内二次停滞不连环放大", () => {
    const stale = { outputGrew: true, lastLiveAt: 0 };
    expect(shouldRebuildCanvas(base({ ...stale, lastKickAt: T0 - 29_999 }))).toBe(false);
    expect(shouldRebuildCanvas(base({ ...stale, lastKickAt: T0 - 30_000 }))).toBe(true);
  });

  it("PTY 静默不判:缓冲字节无变化 = 无从对照(未锚定会话同理有真相)", () => {
    expect(shouldRebuildCanvas(base({ outputGrew: false, lastLiveAt: 0 }))).toBe(false);
  });

  it("边界不变量:静默窗须为正且渲染冻结线小于它(冻结期先退出再谈停滞)", () => {
    expect(STALL_CANVAS_SILENCE_MS).toBeGreaterThan(0);
    expect(STALL_RAF_DEAD_MS).toBeLessThan(STALL_CANVAS_SILENCE_MS);
  });
});
