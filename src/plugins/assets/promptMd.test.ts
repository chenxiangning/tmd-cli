/**
 * 提示词 md 序列化契约测试。
 * 覆盖:frontmatter 往返、无元数据纯正文、多行值压单行(单行解析器约束)、
 * 正文里的 $ 占位符原样保留。
 */
import { describe, expect, it } from "vitest";
import { parsePromptFile, serializePromptFile } from "./promptMd";

describe("promptMd 序列化往返", () => {
  it("全字段往返:description / argument-hint / 正文一致", () => {
    const data = { description: "修复 PR", argumentHint: "PR 号, 重点", content: "修 $PR 的问题\n按阶段来" };
    expect(parsePromptFile(serializePromptFile(data))).toEqual(data);
  });

  it("无元数据 = 纯正文,不加 frontmatter 头", () => {
    expect(serializePromptFile({ content: "直接正文" })).toBe("直接正文");
    expect(parsePromptFile("直接正文")).toEqual({
      description: undefined,
      argumentHint: undefined,
      content: "直接正文",
    });
  });

  it("元数据换行压成空格(frontmatter 单行约束)", () => {
    const text = serializePromptFile({ description: "一\n二", content: "x" });
    expect(text).toContain("description: 一 二");
    expect(parsePromptFile(text).description).toBe("一 二");
  });

  it("$NAME 占位符与正文内 --- 行不被 frontmatter 剥壳误伤", () => {
    const content = "第一行\n---\n修 $NAME";
    expect(parsePromptFile(serializePromptFile({ description: "d", content })).content).toBe(content);
    expect(parsePromptFile(content).content).toBe(content);
  });
});
