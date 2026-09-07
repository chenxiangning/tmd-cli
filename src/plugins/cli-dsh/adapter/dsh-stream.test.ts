/**
 * dsh-stream 底栏钉底契约:scroll region 收缩后底栏只出现在视口第 n 行,
 * 绝对寻址擦/画,内容滚动不进 scrollback。底栏无条件常画:内容写入
 * (print/chunk)绝不触第 n 行,spinner 帧流式中也不消失(「loading 不稳」
 * 根治)。防「底栏烤进 transcript」「Working 撞正文行」回归。
 */

import { describe, expect, it, vi } from "vitest";
import { createStream } from "./dsh-stream.cjs";
import { fitWidth } from "./dsh-render.cjs";

function mk(rowFn?: () => number) {
  const w = vi.fn();
  return { w, s: createStream(w, () => 80, rowFn ?? (() => 24)) };
}
const joined = (w: { mock: { calls: unknown[][] } }) => w.mock.calls.map((c) => c[0]).join("");

describe("dsh-stream", () => {
  it("首画收缩 scroll region 到 1..n-1,底栏绝对寻址画在第 n 行并存还原光标", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    const out = joined(w);
    expect(out).toContain("\x1b[1;23r");            /* region 1..n-1 */
    expect(out).toContain("\x1b[24;1H\x1b[2KSPIN"); /* 第 n 行擦后写 */
    expect(out.endsWith("\x1b8")).toBe(true);       /* 光标还原 */
  });

  it("内容行只写区内,绝不触第 n 行(底栏行受 region 保护,无需擦写)", () => {
    const { w, s } = mk();
    s.setStatus("SPIN");
    w.mockClear();
    s.print("hello");
    const out = joined(w);
    expect(out).toBe("hello\n"); /* 不碰底栏行 */
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

  it("resize:擦旧 n 行位置,按新行数重钉重画", () => {
    const rows = vi.fn(() => 24);
    const { w, s } = mk(rows as unknown as () => number);
    s.setStatus("SPIN");
    w.mockClear();
    rows.mockReturnValue(30);
    s.resize();
    const out = joined(w);
    expect(out).toContain("\x1b[24;1H\x1b[2K\x1b8");  /* 旧位置擦除 */
    expect(out).toContain("\x1b[1;29r");              /* 新 region */
    expect(out).toContain("\x1b[30;1H\x1b[2KSPIN");   /* 新位置重画 */
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
