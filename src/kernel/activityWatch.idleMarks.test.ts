/**
 * 闸 4d 空闲自证(idleMarks)契约 —— 2026-09-17 实证回归。
 * 焦点/重排引发的空闲屏整屏重绘分片,PTY 批边界随时间漂移,字母骨架逐帧新颖,
 * 家具分类(闸 3)挡不住,曾把已完工轮次的「运行时」标签复燃(切 tab/点击
 * 终端即复燃)。CLI 自证空闲(omp 实采 v18.1.22 页脚「· idle」)且无在工自证
 * 且本轮已应答 ⇒ 分片不作任何活动语义;busy 优先;未声明 = 行为不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWatch } from "./activityWatch";

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

/* 空闲屏重绘帧:PTY 分片边界漂移 ⇒ 整屏重绘的可见切片字母骨架逐帧新颖
   (尾字母随帧号轮换),含空闲页脚字面量(「· idle」)。 */
const idleRepaint = (n: number) =>
  `π ◉ GLM Flash ▶ 3% ┃ 1M mc: 28.7K (3%) · idle repaint ${String.fromCharCode(97 + (n % 26))}`;

describe("闸 4d idleMarks 空闲自证", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("完工后空闲自证重绘不复燃:流中新颖骨架帧不再推钟,照常结算不误标蓝", () => {
    const { watch, viewing } = makeWatch();
    viewing.add("s"); // 用户正在查看(截图场景:点开终端看会话)
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500); // 跨过应答回显窗
    watch.onOutput("s", "answer body"); // 应答:answered 置位
    expect(watch.isTurnActive("s")).toBe(true);
    for (let i = 0; i < 50; i++) {
      watch.onOutput("s", idleRepaint(i), false, true);
      vi.advanceTimersByTime(100);
      if (i === 30) expect(watch.isTurnActive("s")).toBe(false); // 帧流中已结算(修复前此处复燃「运行时」)
    }
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
    expect(watch.isUnread("s")).toBe(false); // 查看中结算:保持已读
  });

  it("busy 优先:空闲自证与在工自证同帧,在工持轮照旧,自证钟断供后结算", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    for (let i = 0; i < 40; i++) {
      watch.onOutput("s", `${idleRepaint(i)} ⎋ ${i}s >`, true, true);
      vi.advanceTimersByTime(200);
    }
    expect(watch.isTurnActive("s")).toBe(true); // 在工自证钟持轮
    vi.advanceTimersByTime(31_000);
    expect(watch.isTurnActive("s")).toBe(false);
  });

  it("未应答期不抑制:awaiting 且未 answered 时空闲帧照常开轮(小轮次 /help 不被吞)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", idleRepaint(0), false, true);
    expect(watch.isTurnActive("s")).toBe(true);
  });

  it("未声明 idleMarks = 行为不变:新颖骨架帧仍作 content 持轮", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    for (let i = 0; i < 25; i++) {
      watch.onOutput("s", idleRepaint(i), false, false);
      vi.advanceTimersByTime(100);
      if (i === 20) expect(watch.isTurnActive("s")).toBe(true); // 无空闲自证:既有语义保持
    }
    vi.advanceTimersByTime(3_000);
    expect(watch.isTurnActive("s")).toBe(false);
  });
});
