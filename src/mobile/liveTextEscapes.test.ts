/** 转义族补全回归(自 liveText.test.ts 拆出,300 行铁则;先例 piRpcIds.test.ts):
 *  2026-10-04 复审实锤 —— tok 单字节类缺 =/>(DECKPAM/PNM)与中间字节族
 *  (\x1b%G 等),smkx/rmkx(terminfo \E[?1h\E=,vim/less 进出全屏)字面落屏;
 *  ESC M/D/E 与 CSI E(CNL)缺实现;RI 多余归零列;CSI 空参数位被折叠。 */
import { describe, expect, it } from "vitest";
import { LiveScreen } from "./liveText";

describe("LiveScreen 转义族补全(2026-10-04 复审:smkx/rmkx 与行进语义)", () => {
  it("ESC =/>(DECKPAM/NM)与中间字节族(ESC %G)吞掉不落屏", () => {
    const s = new LiveScreen(10, 3);
    s.feed("\x1b[?1h\x1b=X\x1b>Y");
    expect(s.view()).toBe("XY");
    const s2 = new LiveScreen(10, 3);
    s2.feed("A\x1b%GB");
    expect(s2.view()).toBe("AB");
  });

  it("ESC % 跨 chunk:中间字节结尾挂起不落屏", () => {
    const s = new LiveScreen(10, 3);
    s.feed("A\x1b");
    s.feed("%G");
    s.feed("B");
    expect(s.view()).toBe("AB");
  });

  it("CNL(CSI E)下移 n 行归列首", () => {
    const s = new LiveScreen(10, 3);
    s.feed("ab\x1b[2EX");
    expect(s.view()).toBe("ab\n\nX");
  });

  it("RI(ESC M 与 CSI M)列不动:行中定位后续写不漂到行首", () => {
    const s = new LiveScreen(10, 3);
    s.feed("abc\x1bMX");
    expect(s.view()).toBe("abcX");
    const s2 = new LiveScreen(10, 3);
    s2.feed("abc\x1b[MX");
    expect(s2.view()).toBe("abcX");
  });

  it("IND(ESC D)行进不归列;NEL(ESC E)= CR+LF", () => {
    const s = new LiveScreen(10, 3);
    s.feed("ab\x1bDX");
    expect(s.view()).toBe("ab\n  X");
    const s2 = new LiveScreen(10, 3);
    s2.feed("ab\x1bEX");
    expect(s2.view()).toBe("ab\nX");
  });

  it("CSI 空参数位不折叠:\\x1b[;5H = 默认行 + 第 5 列", () => {
    const s = new LiveScreen(10, 3);
    s.feed("\x1b[;5HX");
    expect(s.view()).toBe("    X");
  });
});
