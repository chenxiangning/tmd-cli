/**
 * terminalSigwinchGuard 契约:SIGWINCH 舞步(1049h → 画帧 → 1049l → H+2J+3J →
 * 内联重画,实测 omp 18.12 字节序)在过滤窗内降级 —— 换屏/清屏 token 剥除、
 * 起点注入 rows-1 换行护住 transcript、帧内容原样放行;窗外(fzf/vim 的 alt
 * 用法)逐字节透传;token 跨块劈开不漏剥;舞步中途过期也要续完。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armSigwinchGuard,
  createSigwinchGuard,
  registerSigwinchGuard,
  releaseSigwinchGuard,
  sigwinchGuardOf,
} from "./terminalSigwinchGuard";

/** 实测 omp 舞步形态(顺序与 token 均来自 2026-10-21 pty 抓包)。 */
const FRAME = "\x1b[?25l\x1b[HOMP-BANNER\r\nTIP\r\nPROMPT> ";
const DANCE = `\x1b[?1049h${FRAME}\x1b[?1049l\x1b[H\x1b[2J\x1b[3J${FRAME}`;

describe("寄存路径(arm 窗口)", () => {
  afterEach(() => {
    vi.useRealTimers();
    releaseSigwinchGuard("s1");
  });

  function armedGuard(rows = 30) {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const g = createSigwinchGuard(() => rows);
    registerSigwinchGuard("s1", g);
    armSigwinchGuard("s1", 2500);
    return g;
  }

  it("完整舞步:只余帧内容,头部注入 rows-1 个换行", () => {
    const g = armedGuard(30);
    expect(g.feed(DANCE)).toBe("\r\n".repeat(29) + FRAME + FRAME);
  });

  it("token 跨块劈开:逐字节喂入仍不漏剥,帧内容完整", () => {
    const g = armedGuard(30);
    let out = "";
    for (const ch of DANCE) out += g.feed(ch);
    expect(out).toBe("\r\n".repeat(29) + FRAME + FRAME);
  });

  it("窗口外:alt 序列逐字节透传(fzf/vim 场景)", () => {
    const g = armedGuard(30);
    vi.advanceTimersByTime(3000); /* 窗口(2.5s)已过 */
    const alt = "\x1b[?1049h\x1b[Hfzf-ui\x1b[?1049l";
    expect(g.feed(alt)).toBe(alt);
  });

  it("舞步中途过期:续完剥除,不半截漏过清缓冲", () => {
    const g = armedGuard(30);
    const head = DANCE.slice(0, DANCE.indexOf("\x1b[?1049l"));
    expect(g.feed(head)).not.toContain("\x1b[?1049h");
    vi.advanceTimersByTime(3000); /* 过期 */
    const tail = DANCE.slice(DANCE.indexOf("\x1b[?1049l"));
    expect(g.feed(tail)).toBe(FRAME); /* l/H/2J/3J 仍剥,重画帧保留 */
  });

  it("连发 resize:两个舞步各自剥除、各自注入", () => {
    const g = armedGuard(10);
    expect(g.feed(DANCE + DANCE)).toBe(
      "\r\n".repeat(9) + FRAME + FRAME + "\r\n".repeat(9) + FRAME + FRAME,
    );
  });

  it("寄存未 arm:透传(安全默认)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const g = createSigwinchGuard(() => 30);
    registerSigwinchGuard("s1", g);
    expect(g.feed(DANCE)).toBe(DANCE);
  });

  it("卸载后 arm 为 no-op:再取守卫为 undefined", () => {
    armedGuard();
    releaseSigwinchGuard("s1");
    armSigwinchGuard("s1");
    expect(sigwinchGuardOf("s1")).toBeUndefined();
  });
});
