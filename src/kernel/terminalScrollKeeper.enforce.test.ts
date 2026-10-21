/**
 * reflow enforcement 窗契约:WebKit 在容器布局变化时反复重置滚动容器 scrollTop,
 * xterm 从 DOM scrollTop 反推 ydisp 归零(真机实测:面板开合后 vp=0 而缓冲完好;
 * Chromium 保 scrollTop 故主套件复现不了)。窗内持续按内容锚钉回;用户输入让位;
 * 锚内容被舞步挪走时自退,不与重印守望打架。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollKeeper } from "./terminalScrollKeeper";

function useFrameClock(): void {
  vi.useFakeTimers();
}
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

afterEach(() => {
  vi.useRealTimers();
});

/** 可变缓冲假体(与主套件 fakeLiveTerm 同形;enforce 用例只需要行数组可换)。 */
function fakeLiveTerm(lines: string[], opts: { cols: number; rows: number; viewportY: number }) {
  let buf = lines;
  const state = {
    viewportY: opts.viewportY,
    baseY: buf.length - opts.rows,
    length: buf.length,
    cols: opts.cols,
    rows: opts.rows,
    getLine: (row: number) =>
      row >= 0 && row < buf.length ? { translateToString: () => buf[row] } : undefined,
  };
  const term = {
    get cols() {
      return state.cols;
    },
    get rows() {
      return state.rows;
    },
    buffer: { active: state },
    scrollToLine: (row: number) => void (state.viewportY = row),
    scrollToBottom: () => void (state.viewportY = state.baseY),
  };
  return {
    term,
    state,
    repopulate(next: string[], viewportY?: number): void {
      buf = next;
      state.length = next.length;
      state.baseY = next.length - state.rows;
      if (viewportY !== undefined) state.viewportY = viewportY;
    },
  };
}

describe("reflow enforcement 窗(WebKit 布局重置对抗)", () => {
  /** WebKit 地精:resetUntil 前每次钉扎后把 vp 拽回 0(模拟布局期滚动容器
   *  scrollTop 反复被重置;动画 ~300ms 后停止,与真实布局窗同量级)。 */
  function goblin(live: ReturnType<typeof fakeLiveTerm>, resetUntil: number): void {
    const origScroll = live.term.scrollToLine;
    live.term.scrollToLine = (row) => {
      origScroll(row);
      if (Date.now() < resetUntil) live.state.viewportY = 0;
    };
  }

  it("窗内地精反复拽顶:停止后钉回锚行终态;窗过后不再干预", async () => {
    useFrameClock();
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    const live = fakeLiveTerm(lines, { cols: 120, rows: 15, viewportY: 10 });
    const k = createScrollKeeper();
    vi.setSystemTime(0);
    k.reflow(live.term, () => {
      live.repopulate(lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]), 12);
    });
    goblin(live, 300);
    await advance(96); /* 动画期:钉→拽→钉… */
    await advance(750); /* 窗(800ms)走完,最后一次钉扎生效 */
    expect(live.state.viewportY).toBe(20);
    /* 窗后无地精也无常驻轮询:再拽不再对抗 */
    live.state.viewportY = 0;
    await advance(96);
    expect(live.state.viewportY).toBe(0);
  });

  it("用户输入取消钉扎:cancel 后地精拽顶不再对抗", async () => {
    useFrameClock();
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    const live = fakeLiveTerm(lines, { cols: 120, rows: 15, viewportY: 10 });
    const k = createScrollKeeper();
    vi.setSystemTime(0);
    k.reflow(live.term, () => {
      live.repopulate(lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]), 12);
    });
    await advance(32);
    k.cancelEnforcement();
    live.state.viewportY = 0;
    await advance(96);
    expect(live.state.viewportY).toBe(0);
  });

  it("锚内容被舞步挪走:钉扎自退,不与重印守望打架", async () => {
    useFrameClock();
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    const live = fakeLiveTerm(lines, { cols: 120, rows: 15, viewportY: 10 });
    const k = createScrollKeeper();
    vi.setSystemTime(0);
    k.reflow(live.term, () => {
      live.repopulate(lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]), 12);
    });
    await advance(32);
    live.repopulate(Array.from({ length: 33 }, (_, i) => `wipe${i}`), 0); /* 抹除:锚没了 */
    await advance(48);
    expect(live.state.viewportY).toBe(0); /* 不再把 wipe 缓冲拽去匹配 row 锚 */
  });
});

