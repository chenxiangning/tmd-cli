/** 用户块图片 token 契约 —— imageTokens(图片扩展名识别/保序去重/非图不收)
 *  与 stripLoaded(已加载 token 摘除、未加载保留、空白压缩)。 */
import { describe, expect, it } from "vitest";
import { imageTokens, stripLoaded } from "./ssUserBlockMeta";

describe("imageTokens", () => {
  it("识别图片扩展名 token,保序去重", () => {
    const text = "@/tmp/a.png 这是什么 @/tmp/b.JPEG 再看 @/tmp/a.png";
    expect(imageTokens(text)).toEqual(["/tmp/a.png", "/tmp/b.JPEG"]);
  });

  it("非图片扩展名/普通 @ 提及不收", () => {
    const text = "@/tmp/x.ts 看这个 @kernel 是什么";
    expect(imageTokens(text)).toEqual([]);
  });

  it("行首行中 token 均可,紧跟标点不误吸", () => {
    const text = "看图 @/tmp/a.png,如何?";
    expect(imageTokens(text)).toEqual(["/tmp/a.png"]);
  });
});

describe("stripLoaded", () => {
  it("已加载的 token 从文本摘除,未加载的保留", () => {
    const text = "@/tmp/a.png 这是什么 @/tmp/b.png 呢";
    const out = stripLoaded(text, { "/tmp/a.png": "data:image/png;base64,x" });
    expect(out).toBe("这是什么 @/tmp/b.png 呢");
  });

  it("全摘除后空白压缩,不残留双空格", () => {
    expect(stripLoaded("@/tmp/a.png  你好", { "/tmp/a.png": "u" })).toBe("你好");
  });
});
