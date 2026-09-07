/**
 * dsh-think 剥离器契约:整标签删、跨 chunk 半截标签扣住、普通尖括号不误删、
 * flush 吐残段。防 MiniMax `</mm:think>` 泄漏进正文回归。
 */

import { describe, expect, it } from "vitest";
import { createThinkStripper } from "./dsh-think.cjs";

describe("dsh-think", () => {
  it("完整标签删除,正文透出", () => {
    const t = createThinkStripper();
    expect(t.feed("</mm:think></mm:think>Now I have a picture.")).toBe("Now I have a picture.");
  });
  it("跨 chunk 半截标签扣住,补齐后删除", () => {
    const t = createThinkStripper();
    expect(t.feed("abc</mm:")).toBe("abc");
    expect(t.feed("think>def")).toBe("def");
  });
  it("普通比较号不误删(a < b 原样)", () => {
    const t = createThinkStripper();
    expect(t.feed("if a < b then")).toBe("if a < b then");
  });
  it("flush 吐出未成标签残段", () => {
    const t = createThinkStripper();
    t.feed("tail <mm:thi");
    expect(t.flush()).toBe("<mm:thi");
  });
});
