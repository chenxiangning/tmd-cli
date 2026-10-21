/**
 * terminalScrollKeeper 契约:活性+可见期记录滚动位;真隐藏(display:none)后
 * 重显恢复 —— 贴底回吸底、中途回原行;未真隐藏(平铺换焦点)不恢复;
 * 隐藏期 ydisp 打回 0 的事件不得污染快照;reflowKeep 非贴底回原行、贴底不插手。
 * xterm 以 ScrollableTerm 最小假体顶替(零 cast,state 与 buffer.active 同对象,poke 直拨)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollKeeper, reflowKeep, type ScrollableTerm } from "./terminalScrollKeeper";

/** 落帧:reflowKeep 的落锚推迟到 rAF(node 无 rAF → 16ms 定时器),假时钟推进。
 *  必须先开假时钟再调度,advance 才命中所挂定时器;恢复交 afterEach。 */
function useFrameClock(): void {
  vi.useFakeTimers();
}
async function advanceFrame(): Promise<void> {
  await vi.advanceTimersByTimeAsync(32);
}

afterEach(() => {
  vi.useRealTimers();
});

function fakeTerm(viewportY: number, baseY: number): {
  term: ScrollableTerm;
  y: () => number;
  poke: (v: number) => void;
} {
  const state = { viewportY, baseY };
  return {
    term: {
      buffer: { active: state },
      scrollToLine: (row) => void (state.viewportY = row),
      scrollToBottom: () => void (state.viewportY = state.baseY),
    },
    y: () => state.viewportY,
    poke: (v) => void (state.viewportY = v),
  };
}

describe("createScrollKeeper", () => {
  it("活性可见期记录;贴底恢复吸底,中途回原行", () => {
    const { term, y } = fakeTerm(1000, 1000);
    const k = createScrollKeeper();
    k.record(term, true, true);
    k.markHidden({ clientWidth: 0 });
    k.restore(term);
    expect(y()).toBe(1000); /* 吸底 */

    const mid = fakeTerm(300, 1000);
    const k2 = createScrollKeeper();
    k2.record(mid.term, true, true);
    mid.poke(0); /* 隐藏期被打回顶(WebKit scroll 事件),快照不受影响 */
    k2.markHidden({ clientWidth: 0 });
    k2.restore(mid.term);
    expect(mid.y()).toBe(300); /* 回原行而非 0 */
  });

  it("未真隐藏(平铺换焦点/宽盒)不恢复;无快照不恢复", () => {
    const { term, y } = fakeTerm(500, 1000);
    const k = createScrollKeeper();
    k.record(term, true, true);
    k.markHidden({ clientWidth: 1200 }); /* 平铺失活:仍可见 */
    k.restore(term);
    expect(y()).toBe(500);

    const k2 = createScrollKeeper();
    const fresh = fakeTerm(0, 0);
    k2.markHidden({ clientWidth: 0 });
    k2.restore(fresh.term); /* 无快照:首显不动 */
    expect(fresh.y()).toBe(0);
  });

  it("record 的可见闸:隐藏期 ydisp=0 事件不覆盖真值", () => {
    const { term, y } = fakeTerm(700, 1000);
    const k = createScrollKeeper();
    k.record(term, true, true);
    k.record(term, true, false); /* 隐藏期补发事件:active 但不可见 */
    k.markHidden({ clientWidth: 0 });
    k.restore(term);
    expect(y()).toBe(700);
  });
});

describe("reflowKeep", () => {
  it("非贴底:重排漂移回原行;贴底:不插手(吸底接管)", async () => {
    useFrameClock();
    const mid = fakeTerm(400, 1000);
    reflowKeep(mid.term, () => mid.poke(123));
    await advanceFrame();
    expect(mid.y()).toBe(400);

    const bottom = fakeTerm(1000, 1000);
    reflowKeep(bottom.term, () => bottom.poke(123));
    await advanceFrame();
    expect(bottom.y()).toBe(123); /* 贴底让位给跟随语义 */
  });

  it("非贴底:换行膨胀致行号漂移时按视口顶行内容重锚", async () => {
    useFrameClock();
    /* 40 行缓冲,视口顶在第 10 行;收窄重排把每行折成两行(行数翻倍),
       xterm 索引保持 = viewportY 纹丝不动,内容却已跳走 —— 应重锚到内容新家。
       fit 后 ydisp 校正异步落地:fit 回调里模拟「下标仍 10」,落帧时才漂到 12。 */
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    let buf = lines;
    const state = {
      viewportY: 10,
      baseY: 39,
      rows: 30,
      getLine: (row: number) =>
        row >= 0 && row < buf.length ? { translateToString: () => buf[row] } : undefined,
    };
    const term: ScrollableTerm = {
      buffer: { active: state },
      scrollToLine: (row) => void (state.viewportY = row),
      scrollToBottom: () => void (state.viewportY = state.baseY),
    };
    reflowKeep(term, () => {
      buf = lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]);
      state.baseY = buf.length - 30;
      state.viewportY = 12; /* xterm 异步校正:落帧时下标已漂 */
    });
    await advanceFrame();
    expect(state.viewportY).toBe(20);
  });

  it("锚行全空白且无 getLine 的假体:退回索引保持(旧行为)", async () => {
    useFrameClock();
    const mid = fakeTerm(400, 1000);
    reflowKeep(mid.term, () => mid.poke(432));
    await advanceFrame();
    expect(mid.y()).toBe(400); /* 漂移后被索引兜底拉回 */
  });
});
