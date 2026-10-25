/**
 * terminalSigwinchGuard 契约:SIGWINCH 舞步(1049h → 画帧 → 1049l → H+2J+3J →
 * 内联重画,实测 omp 18.12 字节序)在过滤窗内降级 —— 换屏/清屏 token 剥除、
 * alt 段内容(帧第一拷贝)整体丢弃、确认时注入 rows-1 换行,仅内联重画拷贝
 * 放行(与回放面 stripDanceEnvelopes 产物对齐);窗外(fzf/vim 的 alt 用法)
 * 逐字节透传;token 跨块劈开不漏剥;舞步中途过期也要续完。
 *
 * 2026-10-25 扣留待确认契约:窗内 1049h 先扣留(hold)不产出 —— 真交互式
 * alt UI(模型选择器,实证 omp /model 的 1049h+13KB 帧驻留无 1049l)与舞步
 * 同以 1049h 开头,须待 1049l 确认才可丢弃;确认窗(DANCE_CONFIRM_MS)尽
 * 未闭合 = 真 alt,hold 原样奉还(emit 主动出口 / feed 被动出口)并 disarm。
 * 回归钉:resize 后窗内点 composer 模型位,picker 帧被吞幕布卡死(大仙实证)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armSigwinchGuard,
  createSigwinchGuard,
  registerSigwinchGuard,
  releaseSigwinchGuard,
  sigwinchGuardOf,
} from "./terminalSigwinchGuard";

/** 实测 omp 舞步形态(顺序与 token 均来自 2026-10-21 pty 抓包);alt/inline
 *  两份拷贝内容不同,钉死「只留内联重画」不靠同文巧合。 */
const ALT = "\x1b[HOMP-ALT-COPY\r\nTIP\r\n";
const INLINE = "OMP-INLINE-COPY\r\nTIP\r\nPROMPT> ";
const DANCE = `\x1b[?1049h${ALT}\x1b[?1049l\x1b[H\x1b[2J\x1b[3J${INLINE}`;

/** 实证 omp /model picker 首段形貌(2026-10-25 pty 抓包,13KB 取形):1049h
 *  进 alt 屏后驻留等用户操作,无 1049l 闭合;Escape 关闭才来 1049l。 */
const PICKER = "\x1b[?1049h\x1b[H\x1b[0m\x1b[38;5;245m  Select a model\x1b[0m\r\n  ▸ glm-4.7\r\n";

describe("寄存路径(arm 窗口)", () => {
  afterEach(() => {
    vi.useRealTimers();
    releaseSigwinchGuard("s1");
  });

  function armedGuard(rows = 30, emit?: (text: string) => void) {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const g = createSigwinchGuard(() => rows);
    if (emit) g.emit = emit;
    registerSigwinchGuard("s1", g);
    armSigwinchGuard("s1", 2500);
    return g;
  }

  it("完整舞步:alt 拷贝丢弃,仅余内联重画,头部注入 rows-1 个换行", () => {
    const g = armedGuard(30);
    expect(g.feed(DANCE)).toBe("\r\n".repeat(29) + INLINE);
  });

  it("token 跨块劈开:逐字节喂入仍不漏剥,alt 拷贝不留残迹", () => {
    const g = armedGuard(30);
    let out = "";
    for (const ch of DANCE) out += g.feed(ch);
    expect(out).toBe("\r\n".repeat(29) + INLINE);
  });

  it("窗口外:alt 序列逐字节透传(fzf/vim 场景)", () => {
    const g = armedGuard(30);
    vi.advanceTimersByTime(3000); /* 窗口(2.5s)已过 */
    const alt = "\x1b[?1049h\x1b[Hfzf-ui\x1b[?1049l";
    expect(g.feed(alt)).toBe(alt);
  });

  it("1049l 跨 feed 迟到(确认窗内):仍按舞步续完剥除,不半截漏过清缓冲", () => {
    const g = armedGuard(30);
    const head = DANCE.slice(0, DANCE.indexOf("\x1b[?1049l"));
    expect(g.feed(head)).not.toContain("\x1b[?1049h");
    vi.advanceTimersByTime(400); /* 舞步亚秒:确认窗(800ms)内迟到 */
    const tail = DANCE.slice(DANCE.indexOf("\x1b[?1049l"));
    expect(g.feed(tail)).toBe("\r\n".repeat(29) + INLINE); /* 换行注入随确认点(l/H/2J/3J 剥,重画帧保留) */
  });

  it("真 alt UI 驻留(picker):扣留不产出,确认窗尽 emit 原样奉还并停扣 —— 回归主断言", () => {
    const emitted: string[] = [];
    const g = armedGuard(30, (t) => emitted.push(t));
    expect(g.feed(PICKER)).toBe(""); /* 不上屏、不注换行(旧实现此处吞帧卡死) */
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(800);
    expect(emitted).toEqual([PICKER]); /* 原样奉还(含 1049h),xterm 正确进 alt */
    expect(g.feed("picker 后续帧")).toBe("picker 后续帧"); /* disarm 后透传 */
  });

  it("舞步与真 alt 同窗竞速(关抽屉点模型链):舞步照剥,picker 扣留后奉还", () => {
    const emitted: string[] = [];
    const g = armedGuard(30, (t) => emitted.push(t));
    expect(g.feed(DANCE + PICKER)).toBe("\r\n".repeat(29) + INLINE);
    expect(emitted).toEqual([]);
    vi.advanceTimersByTime(800);
    expect(emitted).toEqual([PICKER]);
  });

  it("无 emit 装配:被动超时 —— 确认窗尽后的首个 feed 把扣留段原样奉还", () => {
    const g = armedGuard(30);
    expect(g.feed(PICKER)).toBe("");
    vi.advanceTimersByTime(3000); /* 未注入 emit 无 timer,纯时钟推进 */
    expect(g.feed("后续")).toBe(PICKER + "后续");
  });

  it("dispose 清确认 timer:卸载后不再奉还(不写已卸载幕布)", () => {
    const emitted: string[] = [];
    const g = armedGuard(30, (t) => emitted.push(t));
    g.feed(PICKER);
    g.dispose();
    vi.advanceTimersByTime(800);
    expect(emitted).toEqual([]);
  });

  it("连发 resize:两个舞步各自剥除、各自注入", () => {
    const g = armedGuard(10);
    expect(g.feed(DANCE + DANCE)).toBe(
      "\r\n".repeat(9) + INLINE + "\r\n".repeat(9) + INLINE,
    );
  });

  it("实测前奏形态(1049l 后 SGR 复位 + OSC8 闭合):不破尾窗,l..3J 整体剥除", () => {
    const g = armedGuard(30);
    const real = `\x1b[?1049h${ALT}\x1b[?1049l\x1b[0m\x1b]8;;\x07\x1b[H\x1b[2J\x1b[3J${INLINE}`;
    expect(g.feed(real)).toBe("\r\n".repeat(29) + INLINE);
  });

  it("前奏跨块劈开:逐字节喂入仍剥净尾清屏", () => {
    const g = armedGuard(30);
    const real = `\x1b[?1049h${ALT}\x1b[?1049l\x1b[0m\x1b]8;;\x07\x1b[H\x1b[2J\x1b[3J${INLINE}`;
    let out = "";
    for (const ch of real) out += g.feed(ch);
    expect(out).toBe("\r\n".repeat(29) + INLINE);
  });

  it("真 alt 退屏(1049l 后无 3J):32B 预算尽 pending 原样奉还,内容零损失", () => {
    const g = armedGuard(30);
    const restored = "\x1b[2Jrestored-shell-screen" + "x".repeat(24); /* 含 2J,超 32B */
    expect(g.feed(`\x1b[?1049h${ALT}\x1b[?1049l${restored}`)).toBe(
      "\r\n".repeat(29) + restored,
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
