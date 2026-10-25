/**
 * 守卫回放面与停滞契约:① stripDanceEnvelopes —— outputBuffer/磁盘 journal 存
 * 原始字节,全量回放(刷新钮/停滞重建/无冻结快照重挂/磁盘尾)重放历史舞步时
 * 3J 会清掉刚回放出的滚动缓冲,须按「1049h…1049l + 尾清屏含 3J」整体包络剥除
 * 并注入 rows-1 换行;vim/fzf 真 alt(1049l 后无 3J)与残缺形态原样保留。
 * ② 舞步相确认窗超时自愈 —— CLI 死在舞步中途/真 alt 驻留,扣留段原样奉还
 *   (防中毒:不再终身剥真 alt/清屏)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSigwinchGuard, stripDanceEnvelopes } from "./terminalSigwinchGuard";

const FRAME = "\x1b[?25l\x1b[HOMP-BANNER\r\nTIP\r\nPROMPT> ";
const HEAD = "\x1b[?1049h";
const EXIT = "\x1b[?1049l";
const TAIL = "\x1b[H\x1b[2J\x1b[3J";
const DANCE = `${HEAD}${FRAME}${EXIT}${TAIL}${FRAME}`;

describe("stripDanceEnvelopes(回放面舞步包络剥除)", () => {
  it("完整舞步包络:整体剥除,起点注入 rows-1 换行,前后文保留", () => {
    const text = `before${DANCE}after`;
    expect(stripDanceEnvelopes(text, 30)).toBe("before" + "\r\n".repeat(29) + FRAME + "after");
  });

  it("无包络文本原样返回", () => {
    const text = `plain ${FRAME} content`;
    expect(stripDanceEnvelopes(text, 30)).toBe(text);
  });

  it("vim 真 alt(1049l 后无 3J)原样保留", () => {
    const vim = `${HEAD}vim screen${EXIT}restored inline`;
    expect(stripDanceEnvelopes(`see${vim}end`, 30)).toBe(`see${vim}end`);
  });

  it("尾清屏带前奏(SGR 复位 + OSC8 闭合,real_winch 实测形态)照样剥除", () => {
    /* 2026-10-22 real_winch.bin:帧含超链接时 1049l 与 H+2J+3J 之间有
     * \x1b[0m\x1b]8;;\x07 前奏,帧内无超链接时缺省 —— 与 live tail 同律。 */
    const text = `${HEAD}F${EXIT}\x1b[0m\x1b]8;;\x07${TAIL}AFTER`;
    expect(stripDanceEnvelopes(text, 1)).toBe("AFTER");
  });

  it("前奏后仍无 3J(vim 退 alt 带 SGR 复位)原样保留", () => {
    const vim = `${HEAD}vim${EXIT}\x1b[0mrestored`;
    expect(stripDanceEnvelopes(vim, 30)).toBe(vim);
  });

  it("3J 超出 32B 预算不构成舞步签名,原样保留", () => {
    const late = `${HEAD}F${EXIT}${"x".repeat(32)}${TAIL}after`;
    expect(stripDanceEnvelopes(late, 30)).toBe(late);
  });

  it("尾清屏缺 3J(H+2J)不构成舞步签名,原样保留", () => {
    const partial = `${HEAD}${FRAME}${EXIT}\x1b[H\x1b[2J${FRAME}`;
    expect(stripDanceEnvelopes(partial, 30)).toBe(partial);
  });

  it("残缺形态(有尾无头)原样保留", () => {
    const orphan = `${EXIT}${TAIL}content`;
    expect(stripDanceEnvelopes(orphan, 30)).toBe(orphan);
  });

  it("多包络逐个剥除;真 alt 与舞步混排时只剥舞步", () => {
    const vim = `${HEAD}vim${EXIT}inline`; /* 无 3J,保留 */
    const text = `${DANCE}mid${vim}then${DANCE}end`;
    const pad = "\r\n".repeat(9);
    expect(stripDanceEnvelopes(text, 10)).toBe(`${pad}${FRAME}mid${vim}then${pad}${FRAME}end`);
  });

  it("未闭合舞步(1049h 后无 1049l)原样保留", () => {
    const text = `ok${HEAD}dangling frame`;
    expect(stripDanceEnvelopes(text, 30)).toBe(text);
  });
});

describe("舞步相停滞自愈(防中毒)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("CLI 死在舞步中途:确认窗尽后扣留段原样奉还,后续真 alt/清屏字节不再被剥", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const g = createSigwinchGuard(() => 30);
    g.armUntil(Date.now() + 60_000);
    expect(g.feed(HEAD)).toBe(""); /* 进 dance 相,扣留不产出(无 emit 被动超时) */
    vi.setSystemTime(11_000); /* 确认窗(800ms)早已过 */
    const rest = `junk${EXIT}${TAIL}recovered`;
    expect(g.feed(rest)).toBe(HEAD + rest); /* 自愈回 idle:扣留段奉还 + 余量透传 */
  });
});
