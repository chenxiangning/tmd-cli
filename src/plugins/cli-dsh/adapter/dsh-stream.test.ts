/**
 * dsh-stream 底栏钉底契约:scroll region 收缩后底栏只出现在视口第 n 行,
 * 绝对寻址擦/画,内容滚动不进 scrollback。底栏无条件常画:内容写入
 * (print/chunk)绝不触第 n 行,spinner 帧流式中也不消失(「loading 不稳」
 * 根治)。防「底栏烤进 transcript」「Working 撞正文行」回归。
 *
 * 2026-10-02 起补 xterm 语义层断言(纯字节断言看不见的真缺陷):DECSTBM 会把
 * 光标搬到 home,旧实现「存一次 → 设区 → 再存一次 → 只还一次」使还原落在
 * home,后续正文从第 1 行开始覆盖历史;这些坏字节同时被 PTY 日志录下,重开
 * 会话原样复现。字节断言全绿也不能证明光标没丢,故这里用 @xterm/xterm 无头
 * 终端(不开 open(),只 write/resize/buffer)跑真实回放。
 */

import { describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { createStream } from "./dsh-stream.cjs";
import { fitWidth } from "./dsh-render.cjs";

function mk(rowFn?: () => number, colFn?: () => number) {
  const w = vi.fn();
  return { w, s: createStream(w, colFn ?? (() => 80), rowFn ?? (() => 24)) };
}
const joined = (w: { mock: { calls: unknown[][] } }) => w.mock.calls.map((c) => c[0]).join("");

/* ── 无头幕布:PNY 输出处理(ONLCR)后的真实 xterm 画面 ─────────────────── */

/** 真实 PTY 会把子进程的 `\n` 补成 `\r\n`(实测日志 CRLF=LF);无头终端没有
 *  这条线路规程,须在喂入处补上,否则光标列不回车,画面无法对照。 */
const onlcr = (s: string): string => s.replace(/\r?\n/g, "\r\n");

function mkScreen(cols: number, rows: number) {
  const term = new Terminal({ cols, rows, scrollback: 500 });
  return { term, write: (s: string) => term.write(onlcr(s)) };
}

/** 视口文本(按 baseY 对齐,行尾空格裁掉)。 */
function viewport(term: Terminal): string[] {
  const b = term.buffer.active;
  const out: string[] = [];
  for (let i = b.baseY; i < b.baseY + term.rows; i++) {
    const line = b.getLine(i);
    out.push(line ? line.translateToString(false).replace(/\s+$/, "") : "");
  }
  return out;
}
/** 等 xterm 解析队列排空(写完的回调在队列尾触发):定时器不够稳,并发负载下会闪。 */
const settle = (term: Terminal): Promise<void> =>
  new Promise((r) => term.write("\x1b[0m", () => r()));

describe("dsh-stream", () => {
  it("首画:存还原包住设区+擦写,底栏关自动换行写在第 n 行", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    const out = joined(w);
    expect(out.startsWith("\x1b7")).toBe(true);      /* 先存内容光标 */
    expect(out).toContain("\x1b[1;23r");             /* region 1..n-1 */
    expect(out).toContain("\x1b[24;1H\x1b[2KSPIN");   /* 第 n 行擦后写 */
    expect(out).toContain("\x1b[?7l");                /* 写前关自动换行 */
    expect(out).toContain("\x1b[?7h");                /* 写完立刻还原 */
    expect(out.endsWith("\x1b8")).toBe(true);         /* 存还原配对收尾 */
    expect(out.indexOf("\x1b[1;23r")).toBeLessThan(out.indexOf("\x1b[24;1H"));
  });

  it("region 只在行数变化时重发(存还原各自配对,不嵌套)", () => {
    const { w, s } = mk();
    s.setStatus("A");
    w.mockClear();
    s.setStatus("B");
    const out = joined(w);
    expect(out).not.toContain("\x1b[1;23r");          /* 行数没变不重设 */
    expect(out.match(/\x1b7/g)).toHaveLength(1);
    expect(out.match(/\x1b8/g)).toHaveLength(1);
  });

  it("内容行只写区内,绝不触第 n 行(底栏行受 region 保护,无需擦写)", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    w.mockClear();
    s.print("hello");
    expect(joined(w)).toBe("hello\n"); /* 不碰底栏行 */
  });

  it("流式 chunk 中 spinner 常画:setStatus 无条件重画第 n 行(loading 不断)", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    w.mockClear();
    s.chunk("partial text no newline");
    expect(joined(w)).toBe("partial text no newline"); /* 只写正文 */
    w.mockClear();
    s.setStatus("SPIN2"); /* 流式中下一帧 spinner */
    expect(joined(w)).toContain("\x1b[24;1H\x1b[2KSPIN2");
  });

  it("setStatus 空串清底栏(出卡前让位)", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    w.mockClear();
    s.setStatus("");
    const out = joined(w);
    expect(out).toBe("\x1b7\x1b[24;1H\x1b[2K\x1b8");
    expect(out).not.toContain("SPIN");
  });

  it("非 tty(rows=0)不设 region 不画状态行,内容裸流出(管道冒烟)", () => {
    const { w, s } = mk(() => 0);
    s.setStatus("SPIN");
    s.print("hello");
    const out = joined(w);
    expect(out).toBe("hello\n");
  });

  it("arm 出内容前钉区,此后内容光标由终端保证留在区内", () => {
    const { w, s } = mk();
    s.arm();
    expect(joined(w)).toContain("\x1b[1;23r");
    w.mockClear();
    s.arm(); /* 幂等:同尺寸不重发 */
    expect(joined(w)).toBe("");
  });

  it("resize:擦旧 n 行位置,按新行数重钉重画,仍只一对存还原", () => {
    const rows = vi.fn(() => 24);
    const { w, s } = mk(rows as unknown as () => number);
    s.setStatus("SPIN");
    w.mockClear();
    rows.mockReturnValue(30);
    s.resize();
    const out = joined(w);
    expect(out).toContain("\x1b[24;1H\x1b[2K");        /* 旧位置擦除 */
    expect(out).toContain("\x1b[1;29r");               /* 新 region */
    expect(out).toContain("\x1b[30;1H\x1b[2KSPIN");     /* 新位置重画 */
    expect(out.match(/\x1b7/g)).toHaveLength(1);
    expect(out.match(/\x1b8/g)).toHaveLength(1);
  });

  it("reset:擦底栏并复位 region(退出不留缩区)", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    w.mockClear();
    s.reset();
    const out = joined(w);
    expect(out).toContain("\x1b[24;1H\x1b[2K\x1b8");
    expect(out).toContain("\x1b[0r");
  });

  it("write 裸控制序列原样透传(zone erase 用)", () => {
    const { w, s } = mk();
    s.write("\x1b[3A\x1b[J");
    expect(w).toHaveBeenCalledWith("\x1b[3A\x1b[J");
  });

  it("fitWidth:ANSI 感知截断,CJK 记 2 列,控制序列不占宽", () => {
    expect(fitWidth("abc", 10)).toBe("abc");
    const t = fitWidth("中文中文中文", 9); /* 8+1=9 宽内:4字(8列)+… */
    expect(t.replace(/\x1b\[[0-9;]*m/g, "")).toBe("中文中文…");
    const s = fitWidth("\x1b[38;2;1;2;3m" + "x".repeat(30), 12);
    expect(s).toContain("\x1b[38;2;1;2;3m");
    expect(s.replace(/\x1b\[[0-9;]*m/g, "")).toHaveLength(12); /* 11 x + … */
    expect(s.endsWith("\x1b[0m")).toBe(true);
  });

  it("底栏超宽被截进终端宽(防换行残段刷屏)", () => {
    const { w, s } = mk(); /* cols=80 */
    s.setStatus("F".repeat(200));
    const out = joined(w);
    expect(out.length).toBeLessThan(230);
    expect(out).toContain("…");
  });
});

describe("dsh-stream × xterm(光标纪律)", () => {
  it("底栏重画不吞内容光标:后续正文接在正确位置,不覆盖历史", async () => {
    const { term, write } = mkScreen(20, 6);
    const s = createStream(write, () => 20, () => 6);
    s.arm();
    s.print("AAA");
    s.print("BBB");
    s.print("CCC");
    s.setStatus("SPIN");
    s.print("DDD");
    await settle(term);
    expect(viewport(term)).toEqual(["AAA", "BBB", "CCC", "DDD", "", "SPIN"]);
  });

  it("底栏钉在最后一行:整轮内容滚动后底栏不消失、正文不进底栏行", async () => {
    const { term, write } = mkScreen(24, 5);
    const s = createStream(write, () => 24, () => 5);
    s.arm();
    s.setStatus("● model › cwd");
    for (const l of ["L1", "L2", "L3", "L4", "L5", "L6"]) s.print(l);
    await settle(term);
    const view = viewport(term);
    expect(view[4]).toBe("● model › cwd");     /* 底栏始终在第 5 行 */
    expect(view.filter((r) => r === "● model › cwd")).toHaveLength(1);
    /* 正文只在 1..4 行滚动(空行 = 区内待写行),绝不进底栏行 */
    expect(view.slice(0, 4).every((r) => r === "" || /^L\d$/.test(r))).toBe(true);
    expect(view.slice(0, 4)).toContain("L6");
  });

  it("谎报列数(PTY 80 列 / 幕布 20 列)不折行:关自动换行截断,整屏不滚", async () => {
    const { term, write } = mkScreen(20, 6);
    const s = createStream(write, () => 80, () => 6);
    s.arm();
    for (const l of ["L1", "L2", "L3"]) s.print(l);
    s.setStatus("S".repeat(60));
    await settle(term);
    const view = viewport(term);
    expect(view.slice(0, 3)).toEqual(["L1", "L2", "L3"]); /* 内容未被顶掉 */
    expect(view[5]).toBe("S".repeat(20));                 /* 截到真实 20 列 */
  });

  it("resize 后底栏跟到新末行,且不吞内容光标", async () => {
    const { term, write } = mkScreen(20, 6);
    let rows = 6;
    const s = createStream(write, () => 20, () => rows);
    s.arm();
    s.print("AAA");
    s.setStatus("SPIN");
    term.resize(20, 8);
    rows = 8;
    s.resize();
    s.print("BBB");
    await settle(term);
    const view = viewport(term);
    expect(view[0]).toBe("AAA");
    expect(view[1]).toBe("BBB");
    expect(view[7]).toBe("SPIN");
  });
});
