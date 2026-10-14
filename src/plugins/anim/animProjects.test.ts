/**
 * anim 项目文件面纯函数测试 —— 最小解析容错、桩文件名、初始 prompt 要点。
 */

import { describe, expect, it } from "vitest";
import {
  animProjectsDir,
  animSessionRefs,
  buildAnimSessionPrompt,
  isAnimProjectFile,
  parseAnimProject,
  stubProjectFileName,
  stubProjectJson,
} from "./animProjects";

describe("isAnimProjectFile", () => {
  it("只认小写 .json,跳过点前缀与其它后缀", () => {
    expect(isAnimProjectFile("p_anim_x.json")).toBe(true);
    expect(isAnimProjectFile("P.JSON")).toBe(false);
    expect(isAnimProjectFile(".hidden.json")).toBe(false);
    expect(isAnimProjectFile("x.json.bak")).toBe(false);
  });
});

describe("parseAnimProject", () => {
  it("最小合法项目:version/name/scenes 三字段即认", () => {
    expect(parseAnimProject('{"version":1,"name":"演示","scenes":[]}')).toEqual({ name: "演示" });
  });

  it("多余字段(canvas)忽略,scenes 非数组拒绝", () => {
    expect(parseAnimProject('{"version":1,"name":"a","scenes":[],"canvas":{"width":100}}')).toEqual({ name: "a" });
    expect(parseAnimProject('{"version":1,"name":"a","scenes":{}}')).toBeNull();
  });

  it("坏 JSON/version 不为 1/名字为空 = 无效项目", () => {
    expect(parseAnimProject("{oops")).toBeNull();
    expect(parseAnimProject('{"version":2,"name":"a","scenes":[]}')).toBeNull();
    expect(parseAnimProject('{"version":1,"name":"  ","scenes":[]}')).toBeNull();
    expect(parseAnimProject('"plain string"')).toBeNull();
  });
});

describe("stubProjectJson / stubProjectFileName", () => {
  it("桩即最小合法项目,能被自家解析器认回", () => {
    const parsed = parseAnimProject(stubProjectJson());
    expect(parsed).toEqual({ name: "未命名动画" });
  });

  it("桩文件名 = p_anim_<base36 时间>_<短随机>.json", () => {
    expect(stubProjectFileName(0xabc12, "w9x2")).toBe(`p_anim_${(0xabc12).toString(36)}_w9x2.json`);
  });
});

describe("buildAnimSessionPrompt", () => {
  const prompt = buildAnimSessionPrompt();

  it("指令语义:协议材料/目标项目以随附引用表述,路径不入正文", () => {
    expect(prompt).toContain("随附引用文件");
    expect(prompt).toContain("pnpm anim validate");
    expect(prompt).not.toContain("/.tmd-anim/protocol/schema.md");
  });

  it("写明 validate 仅在 tmd-anim 仓库内可用", () => {
    expect(prompt).toContain("只在 tmd-anim 仓库内可用");
  });
});

describe("animSessionRefs", () => {
  const refs = animSessionRefs("/Users/u", "/Users/u/.tmd-anim/projects/p.json");

  it("协议材料两件与目标项目三个引用,label 为 i18n 源键", () => {
    expect(refs.map((ref) => `${ref.label}:${ref.path}`)).toEqual([
      "协议 schema:/Users/u/.tmd-anim/protocol/schema.md",
      "协议示例:/Users/u/.tmd-anim/protocol/bpe-example.json",
      "目标项目:/Users/u/.tmd-anim/projects/p.json",
    ]);
  });
});

describe("animProjectsDir", () => {
  it("拼接 home 绝对路径", () => {
    expect(animProjectsDir("/Users/u")).toBe("/Users/u/.tmd-anim/projects");
  });
});
