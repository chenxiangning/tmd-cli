/**
 * extractPromptImages 契约测试 —— 审批线用户消息卡的图片附件剥离。
 * 契约:只剥 composer 注入的 @绝对路径.图片扩展名 token;非图片附件 token、
 * 裸路径(无 @ 前缀)一律保留在原文;图片列表按出现顺序去重。
 */
import { describe, expect, it } from "vitest";
import { extractPromptImages } from "./PromptImages";

describe("extractPromptImages", () => {
  it("图片 token 剥离为附件,净文本保留指令", () => {
    const r = extractPromptImages(
      "@/var/folders/T/tmd-cli/upload-1.png 工作区眼睛不对. 置顶区域是对的.",
    );
    expect(r.images).toEqual(["/var/folders/T/tmd-cli/upload-1.png"]);
    expect(r.text).toBe("工作区眼睛不对. 置顶区域是对的.");
  });

  it("多张图片按出现顺序去重", () => {
    const r = extractPromptImages("@/a/1.png @/b/2.JPG @/a/1.png 对比这三处");
    expect(r.images).toEqual(["/a/1.png", "/b/2.JPG"]);
    expect(r.text).toBe("对比这三处");
  });

  it("纯附件消息:净文本为空(调用方不渲染文本块)", () => {
    expect(extractPromptImages("@/tmp/upload-1.png").text).toBe("");
  });

  it("非图片附件 token 与裸路径不剥:保留在原文", () => {
    const r = extractPromptImages("@/tmp/notes.txt 和 /tmp/loose.png 都不是附件");
    expect(r.images).toEqual([]);
    expect(r.text).toBe("@/tmp/notes.txt 和 /tmp/loose.png 都不是附件");
  });

  it("token 后紧跟中文句读也能判定边界", () => {
    const r = extractPromptImages("@/a/shot.webp，帮我看下图");
    expect(r.images).toEqual(["/a/shot.webp"]);
    expect(r.text).toBe("，帮我看下图");
  });

  it("无图片 token 时原文原样返回(不做空白改写)", () => {
    const raw = "第一行\n  第二行  保留间距";
    expect(extractPromptImages(raw)).toEqual({ images: [], text: raw });
  });
});
