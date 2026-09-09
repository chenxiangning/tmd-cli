/**
 * extractTimelineParts 契约测试 —— 时间线用户消息的附件拆解。
 * 契约:图片归 images(复用 extractPromptImages)、非图片 @绝对路径归 files,
 * 两类 token 都从净文本剥离;裸路径(无 @ 前缀)与正文一律保留。
 */
import { describe, expect, it } from "vitest";
import { extractTimelineParts } from "./timelineText";

describe("extractTimelineParts", () => {
  it("图片与文件混合:各归各位,净文本留指令", () => {
    const r = extractTimelineParts(
      "@/tmp/shot.png 看这张图,逻辑在 @/repo/src/kernel/host.ts 附近",
    );
    expect(r.images).toEqual(["/tmp/shot.png"]);
    expect(r.files).toEqual(["/repo/src/kernel/host.ts"]);
    expect(r.text).toBe("看这张图,逻辑在  附近");
  });

  it("纯图片消息:files 空、净文本空(不渲染文本块)", () => {
    expect(extractTimelineParts("@/tmp/upload-1.png")).toEqual({
      text: "",
      images: ["/tmp/upload-1.png"],
      files: [],
    });
  });

  it("同一路径重复引用去重", () => {
    const r = extractTimelineParts("@/a/b.ts 和 @/a/b.ts 一起看");
    expect(r.files).toEqual(["/a/b.ts"]);
  });

  it("裸路径(无 @ 前缀)不当附件:留在净文本", () => {
    const r = extractTimelineParts("/tmp/loose.ts 这个文件有问题");
    expect(r.files).toEqual([]);
    expect(r.text).toBe("/tmp/loose.ts 这个文件有问题");
  });

  it("token 后紧跟中文句读也能判定边界", () => {
    const r = extractTimelineParts("@/a/notes.txt,帮我总结");
    expect(r.files).toEqual(["/a/notes.txt"]);
    expect(r.text).toBe(",帮我总结");
  });

  it("无附件时原文原样返回(不做空白改写)", () => {
    const raw = "第一行\n  第二行  保留间距";
    expect(extractTimelineParts(raw)).toEqual({ text: raw, images: [], files: [] });
  });
});
