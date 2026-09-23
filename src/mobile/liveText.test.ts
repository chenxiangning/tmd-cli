/**
 * LiveScreen 契约:回退式重绘(spin/状态栏)按行覆写收敛为一份;线性输出累积;
 * 清屏/备屏重置;越界 CUP 忽略;私有 CSI/OSC 剥除;滚动上限。
 * 真机两次实证(重复刷屏):纯文本累加与帧界启发式都治不了光标回退重绘。
 */
import { describe, expect, it } from "vitest";
import { LiveScreen } from "./liveText";

describe("LiveScreen 重绘收敛", () => {
  it("spinner 原地重绘(上移+行擦除):屏上只有一份", () => {
    const s = new LiveScreen();
    s.feed("⠋ Working...\n");
    for (const f of ["⠙", "⠹", "⠸"]) {
      s.feed(`\x1b[1A\x1b[2K${f} Working...\n`);
    }
    expect(s.view()).toBe("⠸ Working...");
  });

  it("状态栏 CUP 定位覆写:只替换目标行,不动其它", () => {
    const s = new LiveScreen();
    s.feed("a\nb\nc\n");
    s.feed("\x1b[2;1H\x1b[2KB2");
    expect(s.view()).toBe("a\nB2\nc");
  });

  it("线性输出(无回退)逐行累积", () => {
    const s = new LiveScreen();
    s.feed("l1\nl2\n");
    s.feed("l3\n");
    expect(s.view()).toBe("l1\nl2\nl3");
  });

  it("清屏(2J/3J)与备屏切换(1049h/l)重置屏", () => {
    const s = new LiveScreen();
    s.feed("旧\n\x1b[2J新");
    expect(s.view()).toBe("新");
    s.feed("\x1b[?1049hpicker");
    expect(s.view()).toBe("picker");
    s.feed("\x1b[?1049lback");
    expect(s.view()).toBe("back");
  });

  it("越界 CUP(999 行)忽略:不覆写末行", () => {
    const s = new LiveScreen();
    s.feed("a\n");
    s.feed("\x1b[999;1Hzz");
    expect(s.view()).toBe("a\nzz");
  });

  it("私有前缀 CSI 与 OSC 标题剥除", () => {
    const s = new LiveScreen();
    s.feed("\x1b]0;omp\x07\x1b[>4;2mhi");
    expect(s.view()).toBe("hi");
  });

  it("超屏高上滚:保留最近 MAX_ROWS 行", () => {
    const s = new LiveScreen();
    for (let i = 0; i < 500; i++) s.feed(`line-${i}\n`);
    const out = s.view().split("\n");
    expect(out).toHaveLength(400);
    expect(out[0]).toBe("line-100");
    expect(out[399]).toBe("line-499");
  });

  it("分块到达的转义序列不丢语义(跨 chunk 边界)", () => {
    /* 跨 chunk 的 CSI 被缓冲拼回:1A 上移 + 2K 擦行,second 行替换为 fixed。 */
    const s = new LiveScreen();
    s.feed("first\nsec");
    s.feed("ond\n");
    s.feed("\x1b[");
    s.feed("1A\x1b[2K");
    s.feed("fixed\n");
    expect(s.view()).toBe("first\nfixed");
  });
});
