/**
 * busy 自证持轮窗按引擎覆盖(busyHoldMs)契约 —— 2026-09-25 实证回归。
 * omp v18.3.1 exec 期渲染冻结:长静默工具整屏最长 ~60s 无任何帧(分钟跳格),
 * 默认 30s 自证窗必过期假结算,且结算后被轮次开启闸(I2)拦死永不自愈,
 * 徽标卡「空闲」直至轮次真结束。插件经 busyHoldMs 拉宽窗口盖住冻结。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWatch } from "./activityWatch";
import { stripAnsi } from "./askDetect";

function makeWatch() {
  const viewing = new Set<string>();
  const watch = new ActivityWatch({
    isViewing: (id) => viewing.has(id),
    exists: () => true,
    noiseGated: () => true,
    onChange: () => undefined,
    onTurnSettled: () => undefined,
  });
  return { watch, viewing };
}

/* omp v18.3.1 工作页脚实测帧:braille spinner + elapsed 计时。 */
const busyFrame = (elapsed: string) => stripAnsi(`\u001b[1;1H ⠧ ${elapsed} > ◉ GLM-5.3-Flash`);

describe("busyHoldMs 按引擎覆盖", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("默认 30s 窗:busy 帧断供 31s 照常结算(未声明插件的既有行为不变)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", busyFrame("5s"), true);
    expect(watch.isTurnActive("s")).toBe(true);
    vi.advanceTimersByTime(31_000);
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("omp 18.3 渲染冻结回归:60s 帧静默在 75s 窗内不假结算,分钟跳格续窗,完工后照常收口", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.setBusyHold("s", 75_000);
    watch.onOutput("s", "question echoed"); // 回显开轮
    watch.onOutput("s", busyFrame("59s"), true);
    expect(watch.isTurnActive("s")).toBe(true);
    /* exec 冻结:整 60s 无任何帧(旧 30s 窗在 +31s 即假结算并卡死「空闲」)。 */
    vi.advanceTimersByTime(45_000);
    expect(watch.isTurnActive("s")).toBe(true); // 冻结中途不结算
    vi.advanceTimersByTime(15_000);
    watch.onOutput("s", busyFrame("1m"), true); // 分钟跳格:第一帧真帧
    expect(watch.isTurnActive("s")).toBe(true); // 冻结幸存,轮次未断
    /* 再次冻结 60s 仍被盖住。 */
    vi.advanceTimersByTime(60_000);
    watch.onOutput("s", busyFrame("2m"), true);
    expect(watch.isTurnActive("s")).toBe(true);
    /* 完工换装:braille 页脚消失,busy 钟出 75s 窗后照常结算,不永挂。 */
    vi.advanceTimersByTime(76_000);
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("setBusyHold 不为未建档会话建档(幽灵守望条目防线)", () => {
    const { watch } = makeWatch();
    watch.setBusyHold("ghost", 75_000);
    expect(watch.isTurnActive("ghost")).toBe(false);
    /* 未锚定 = 首写闸后零语义,建档不发生。 */
    watch.onOutput("ghost", "noise");
    expect(watch.isTurnActive("ghost")).toBe(false);
  });
});
