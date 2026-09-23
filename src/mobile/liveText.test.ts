/**
 * LiveScreen 视口契约:回退式重绘(spin/状态栏/页脚)按行覆写收敛为一份;
 * 固定视口高度 + LF 触底上滚(滚出行进 scrollback,view 全量可上翻)+ DECAWM 换行;
 * 清屏/备屏 = 翻页(旧屏进 scrollback);CUP 夹在视口内;私有 CSI/OSC 剥除;
 * 跨 chunk 未完成转义缓冲拼回。
 * 真机三次实证(重复刷屏):纯文本累加与帧界启发式都治不了绝对定位重绘。
 */
import { describe, expect, it } from "vitest";
import { LiveScreen } from "./liveText";

describe("LiveScreen 重绘收敛", () => {
  it("spinner 原地重绘(上移+行擦除):屏上只有一份", () => {
    const s = new LiveScreen(80, 24);
    s.feed("⠋ Working...\n");
    for (const f of ["⠙", "", "⠸"]) {
      s.feed(`\x1b[1A\x1b[2K${f} Working...\n`);
    }
    expect(s.view()).toBe("⠸ Working...");
  });

  it("状态栏 CUP 定位覆写:只替换目标行,不动其它", () => {
    const s = new LiveScreen(80, 24);
    s.feed("a\nb\nc\n");
    s.feed("\x1b[2;1H\x1b[2KB2");
    expect(s.view()).toBe("a\nB2\nc");
  });
  it("页脚钉底行:正文超视口后上滚,视口内页脚不散落", () => {
    const s = new LiveScreen(20, 4);
    /* 模拟 omp:正文逐行 + 页脚恒画在第 4 行。 */
    for (let i = 1; i <= 10; i++) {
      s.feed(`line-${i}\n`);
      s.feed("\x1b[4;1H\x1b[2Kfooter");
    }
    const out = s.view().split("\n");
    const vp = out.slice(-4); // scrollback 之后 = 当前视口
    expect(vp[vp.length - 1]).toBe("footer");
    /* 视口只有 4 行,footer 仅一份(滚出的旧页脚进历史,不算散落)。 */
    expect(vp.filter((l) => l === "footer")).toHaveLength(1);
  });

  it("线性输出(无回退)逐行累积", () => {
    const s = new LiveScreen(80, 24);
    s.feed("l1\nl2\n");
    s.feed("l3\n");
    expect(s.view()).toBe("l1\nl2\nl3");
  });

  it("清屏/备屏 = 翻页:旧屏进 scrollback,新屏从干净视口开始", () => {
    const s = new LiveScreen(80, 24);
    s.feed("旧\n\x1b[2J新");
    expect(s.view()).toBe("旧\n新");
    s.feed("\x1b[?1049hpicker");
    expect(s.view()).toBe("旧\n新\npicker");
    s.feed("\x1b[?1049lback");
    expect(s.view()).toBe("旧\n新\npicker\nback");
  });

  it("越界 CUP 夹到底行(真终端语义)", () => {
    const s = new LiveScreen(80, 4);
    s.feed("a\n");
    s.feed("\x1b[999;1Hzz");
    const out = s.view().split("\n");
    expect(out[0]).toBe("a");
    expect(out[out.length - 1]).toBe("zz");
    expect(out).toHaveLength(4);
  });

  it("DECAWM:超列自动换行,?7l 关闭后钉在末列", () => {
    const s = new LiveScreen(4, 4);
    s.feed("abcdef");
    expect(s.view()).toBe("abcd\nef");
    const t = new LiveScreen(4, 4);
    t.feed("\x1b[?7l");
    t.feed("abcd");
    t.feed("\x1b[1;1H");
    t.feed("XY");
    expect(t.view()).toBe("XYcd");
  });

  it("私有前缀 CSI 与 OSC 标题剥除", () => {
    const s = new LiveScreen(80, 24);
    s.feed("\x1b]0;omp\x07\x1b[>4;2mhi");
    expect(s.view()).toBe("hi");
  });

  it("超视口 LF 上滚:滚出行进 scrollback,view 保留全量历史", () => {
    const s = new LiveScreen(80, 400);
    for (let i = 0; i < 500; i++) s.feed(`line-${i}\n`);
    const out = s.view().split("\n");
    /* 手机「看全输出」契约:line-0 不被丢弃,末行 = 最新。 */
    expect(out[0]).toBe("line-0");
    expect(out[out.length - 1]).toBe("line-499");
    expect(out).toHaveLength(500);
  });

  it("scrollback 有界:超上限丢最老行,保最新", () => {
    const s = new LiveScreen(80, 4);
    for (let i = 0; i < 2100; i++) s.feed(`line-${i}\n`);
    const out = s.view().split("\n");
    /* 2097 次上滚,scrollback 截尾 2000(line-97..line-2096)+ 视口 3 行非空。 */
    expect(out).toHaveLength(2003);
    expect(out[out.length - 1]).toBe("line-2099");
    expect(out[0]).toBe("line-97");
  });

  it("分块到达的转义序列不丢语义(跨 chunk 边界)", () => {
    /* 跨 chunk 的 CSI 被缓冲拼回:1A 上移 + 2K 擦行,second 行替换为 fixed。 */
    const s = new LiveScreen(80, 24);
    s.feed("first\nsec");
    s.feed("ond\n");
    s.feed("\x1b[");
    s.feed("1A\x1b[2K");
    s.feed("fixed\n");
    expect(s.view()).toBe("first\nfixed");
  });
});
