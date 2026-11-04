/** 用户块图片 token 契约 —— imageTokens(图片扩展名识别/保序去重/非图不收)
 *  与 stripLoaded(已加载 token 摘除、未加载保留、空白压缩)。 */
import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { imageTokens, imageSrcs, stripLoaded } from "./ssUserBlockMeta";

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

describe("imageSrcs(图片单源律)", () => {
  const engineBlock: CliTranscriptBlock = {
    id: "1", role: "user", text: "@/a.png 啥",
    images: [{ mimeType: "image/png", data: "AAA" }],
  };

  it("引擎 images 在席 → 只出引擎源;token 加载路整体让位(不双行)", () => {
    expect(imageSrcs(engineBlock, { "/a.png": "data:token" })).toEqual([
      { key: "image/png:3", src: "data:image/png;base64,AAA" },
    ]);
  });

  it("同图多贴:指纹 key 带重复序号,不用数组下标", () => {
    const twin: CliTranscriptBlock = {
      id: "2", role: "user", text: "",
      images: [
        { mimeType: "image/png", data: "AAA" },
        { mimeType: "image/png", data: "AAA" },
      ],
    };
    expect(imageSrcs(twin, {}).map((s) => s.key)).toEqual(["image/png:3", "image/png:3#1"]);
  });

  it("无引擎 images → 已加载 token 兜底(omp follow_up 本地回显)", () => {
    expect(imageSrcs({ id: "3", role: "user", text: "@/b.png" }, { "/b.png": "data:b" })).toEqual([
      { key: "/b.png", src: "data:b" },
    ]);
  });
});
