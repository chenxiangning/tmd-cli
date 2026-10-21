/**
 * terminalScrollKeeper 契约:活性+可见期记录滚动位;真隐藏(display:none)后
 * 重显恢复 —— 贴底回吸底、中途回原行;未真隐藏(平铺换焦点)不恢复;
 * 隐藏期 ydisp 打回 0 的事件不得污染快照。
 * reflow 两段:第一段 raf 内容锚(纯 xterm 重排,无抹除场景);第二段 SIGWINCH
 * 抹除重印感知 —— TUI CLI 尺寸变化会清滚动缓冲并整篇重印(实测 omp),等重印
 * 落定(缓冲行数停涨)后按改尺寸前视口顶行文本全缓冲重锚。
 * xterm 以 ScrollableTerm 最小假体顶替(零 cast,state 与 buffer.active 同对象,
 * poke 直拨)。假时钟推帧,无真实等待。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollKeeper, type ScrollableTerm } from "./terminalScrollKeeper";

/** 落帧:reflow 第一段推迟到 rAF(node 无 rAF → 16ms 定时器),第二段轮询
 *  120ms 一拍。必须先开假时钟再调度,advance 才命中所挂定时器;恢复交 afterEach。 */
function useFrameClock(): void {
  vi.useFakeTimers();
}
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
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

/** 可变缓冲假体:reflow 抹除/重印模拟用(行数组可换、行列长度可拨)。 */
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
  const term: ScrollableTerm = {
    /* cols/rows 是 term 顶层契约(reflow 尺寸变化判定读这里),getter 透传 state */
    get cols() {
      return state.cols;
    },
    get rows() {
      return state.rows;
    },
    buffer: { active: state },
    scrollToLine: (row) => void (state.viewportY = row),
    scrollToBottom: () => void (state.viewportY = state.baseY),
  };
  return {
    term,
    state,
    /** 重印模拟:换行数组并同步 length/baseY(可选拨 viewportY,默认吸底语义由真 xterm 决定,这里显式拨)。 */
    repopulate(next: string[], viewportY?: number): void {
      buf = next;
      state.length = next.length;
      state.baseY = next.length - state.rows;
      if (viewportY !== undefined) state.viewportY = viewportY;
    },
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

describe("reflow 第一段(raf 内容锚)", () => {
  it("非贴底:重排漂移回原行;贴底:不插手(吸底接管)", async () => {
    useFrameClock();
    const k = createScrollKeeper();
    const mid = fakeTerm(400, 1000);
    k.reflow(mid.term, () => mid.poke(123));
    await advance(32);
    expect(mid.y()).toBe(400);

    const bottom = fakeTerm(1000, 1000);
    k.reflow(bottom.term, () => bottom.poke(123));
    await advance(32);
    expect(bottom.y()).toBe(123); /* 贴底让位给跟随语义 */
  });

  it("非贴底:换行膨胀致行号漂移时按视口顶行内容重锚", async () => {
    /* 40 行缓冲(rows=15 → 贴底起始 25,视口顶在第 10 行 = 中途);收窄重排把
       每行折成两行,索引保持内容跳走。fit 后 ydisp 校正异步落地:fit 回调里
       模拟「下标已漂到 12」,落帧重锚到内容新家(第 20 行)。 */
    useFrameClock();
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    const live = fakeLiveTerm(lines, { cols: 120, rows: 15, viewportY: 10 });
    const k = createScrollKeeper();
    k.reflow(live.term, () => {
      live.repopulate(
        lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]),
        12,
      );
    });
    await advance(32);
    expect(live.state.viewportY).toBe(20);
  });

  it("无抹除时探测窗自动解除,不产生额外滚动", async () => {
    useFrameClock();
    const lines = Array.from({ length: 40 }, (_, i) => `row${i} ` + "c".repeat(50));
    const live = fakeLiveTerm(lines, { cols: 120, rows: 15, viewportY: 10 });
    const k = createScrollKeeper();
    k.reflow(live.term, () => {
      live.repopulate(lines.flatMap((l) => [l.slice(0, 30), l.slice(30)]), 12);
    });
    await advance(32);
    const afterRaf = live.state.viewportY;
    expect(afterRaf).toBe(20); /* 第一段已重锚 */
    await advance(2400); /* 探测窗(12 拍 ×120ms)走完 */
    expect(live.state.viewportY).toBe(afterRaf); /* 无抹除 → 无第二段动作 */
  });
});

describe("reflow 第二段(SIGWINCH 抹除重印重锚)", () => {
  it("抹除后整篇重印:落定后按锚文本滚回内容新家", async () => {
    useFrameClock();
    /* 宽幕 701 行,视口顶在第 645 行;尺寸变化触发 CLI 清缓冲重印:
       缓冲先腰斩到 33 行(2J+3J),再长回 1395 行,锚内容的新家在第 1290 行。 */
    const wide = Array.from({ length: 701 }, (_, i) => `w${i} ` + "x".repeat(80));
    const live = fakeLiveTerm(wide, { cols: 120, rows: 33, viewportY: 645 });
    const k = createScrollKeeper();
    k.reflow(live.term, () => {
      live.state.cols = 49; /* SIGWINCH:尺寸真变 */
      live.repopulate(
        wide.flatMap((l) => [l.slice(0, 40), l.slice(40)]),
        662, /* xterm 重排索引保持 */
      );
    });
    await advance(32); /* 第一段(此缓冲下 est 邻域,无碍) */
    live.repopulate(Array.from({ length: 33 }, (_, i) => `wipe${i}`), 0); /* 2J+3J */
    await advance(120); /* 拍 1:发现腰斩 */
    /* 重印 = 同内容新宽度(原第 645 行 w645 → 新缓冲第 1290 行) */
    live.repopulate(
      wide.flatMap((l) => [l.slice(0, 40), l.slice(40)]),
      0,
    );
    await advance(120); /* 拍 2 */
    live.state.viewportY = 1362; /* 重印期打回底附近 */
    await advance(120); /* 拍 3(行数停涨 1) */
    await advance(120); /* 拍 4(停涨 2) */
    await advance(120); /* 拍 5(停涨 3 → 落定重锚) */
    expect(live.state.viewportY).toBe(1290);
  });

  it("抹除后重印但锚内容不再出现:不乱滚", async () => {
    useFrameClock();
    const wide = Array.from({ length: 200 }, (_, i) => `w${i} unique-anchor-${i} xxxx`);
    const live = fakeLiveTerm(wide, { cols: 120, rows: 30, viewportY: 150 });
    const k = createScrollKeeper();
    k.reflow(live.term, () => {
      live.state.cols = 49;
      live.repopulate(wide, 150);
    });
    await advance(32);
    live.repopulate(Array.from({ length: 20 }, (_, i) => `fresh${i}`), 0); /* 抹除 */
    await advance(120);
    live.repopulate(Array.from({ length: 60 }, (_, i) => `other${i} yyy`), 40); /* 重印(无锚) */
    await advance(120 * 5);
    expect(live.state.viewportY).toBe(40); /* 未找到锚:维持重印自然位 */
  });

  it("新 reflow 顶替旧 watch:过期轮询不再滚动", async () => {
    useFrameClock();
    const wide = Array.from({ length: 300 }, (_, i) => `w${i} ` + "x".repeat(60));
    const live = fakeLiveTerm(wide, { cols: 120, rows: 30, viewportY: 200 });
    const k = createScrollKeeper();
    k.reflow(live.term, () => {
      live.state.cols = 49;
      live.repopulate(wide, 200);
    });
    await advance(32);
    live.repopulate(Array.from({ length: 20 }, (_, i) => `wipe${i}`), 0); /* 第一次抹除 */
    await advance(120);
    /* 第二次 reflow(gen 顶替)+ 又一次抹除重印 */
    const wide2 = Array.from({ length: 300 }, (_, i) => `v${i} ` + "y".repeat(60));
    live.repopulate(wide2, 200);
    k.reflow(live.term, () => {
      live.state.cols = 70;
      live.repopulate(wide2, 200);
    });
    await advance(32);
    live.repopulate(Array.from({ length: 1395 }, (_, i) => `n${i} zzz`), 0);
    await advance(120 * 10);
    /* 旧 watch(w 锚)不得把视口拽去匹配 w 行;新 watch 锚 v200 在 n 行中不存在 → 不动 */
    expect(live.state.viewportY).toBe(0);
  });
});
