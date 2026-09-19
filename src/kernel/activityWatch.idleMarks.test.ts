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

describe("闸 4d 升级:空闲自证兼作结算证据(2026-09-18,完工换装快速收口)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("完工换装即武装:确认窗 ~2s 后结算,不再等 30s busy 自证窗", () => {
    const { watch, viewing } = makeWatch();
    viewing.add("s"); // 用户正在查看(完成即已读,徽标翻「空闲」)
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    watch.onOutput("s", "⎋ 3s > ◉ working", true, false); // 工作页脚自证在途
    vi.advanceTimersByTime(1_000);
    watch.onOutput("s", idleRepaint(0), false, true); // 完工换装:空闲帧武装
    expect(watch.isTurnActive("s")).toBe(true); // 确认窗内仍「运行时」
    vi.advanceTimersByTime(2_500);
    expect(watch.isTurnActive("s")).toBe(false); // ~2s 收口,而非 30s
    expect(watch.isUnread("s")).toBe(false); // 查看中结算:已读
  });

  it("确认窗内 busy 反证撤武装:工作期整帧重绘(busy+idle 同帧,实测 6 帧形态)不提前结算", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    watch.onOutput("s", `${idleRepaint(0)} ⎋ 3s >`, true, true); // 工作期重绘:busy 优先
    vi.advanceTimersByTime(100);
    watch.onOutput("s", idleRepaint(1), false, true); // 假想 mc 裸帧:武装
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "⎋ 4s > ◉ footer", true, false); // busy 反证:撤武装
    vi.advanceTimersByTime(2_500);
    expect(watch.isTurnActive("s")).toBe(true); // 在工自证钟持轮,未被旧武装结算
  });

  it("answered 前置:思考期(未应答)空闲帧不武装,轮次由天花板保护照常在途", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    watch.onOutput("s", idleRepaint(0), false, true); // awaiting 且未 answered
    expect(watch.isTurnActive("s")).toBe(true); // 小轮次不被吞(既有语义)
    vi.advanceTimersByTime(2_500);
    expect(watch.isTurnActive("s")).toBe(true); // 未被空闲帧提前结算
  });

  it("武装后新用户写入清武装:新一轮提问不被上一轮空闲尾证据误结算", () => {
    const { watch, viewing } = makeWatch();
    viewing.add("s");
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    watch.onOutput("s", idleRepaint(0), false, true); // 武装
    vi.advanceTimersByTime(500);
    watch.onUserWrite("s"); // 新提问 = 新基线
    vi.advanceTimersByTime(2_500);
    expect(watch.isTurnActive("s")).toBe(true); // 旧武装已撤,由天花板持轮
  });

  it("未声明 idleMarks 的 CLI 不武装:结算仍走 30s busy 窗(行为不变)", () => {
    const { watch } = makeWatch();
    watch.onUserWrite("s");
    vi.advanceTimersByTime(500);
    watch.onOutput("s", "answer body");
    watch.onOutput("s", "⎋ 3s > ◉ working", true, false);
    vi.advanceTimersByTime(1_000);
    watch.onOutput("s", "plain footer frame", false, false); // 无空闲自证
    vi.advanceTimersByTime(3_000);
    expect(watch.isTurnActive("s")).toBe(true); // 2s/5s 窗均不足以收口
    vi.advanceTimersByTime(30_000);
    expect(watch.isTurnActive("s")).toBe(false); // 30s busy 窗兜底
  });
});
