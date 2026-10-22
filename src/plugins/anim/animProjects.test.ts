/**
 * anim 项目文件面纯函数测试 —— 最小解析容错、桩文件名、初始 prompt 要点。
 */

import { describe, expect, it } from "vitest";
import {
  animOpenAction,
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
  it("最小合法项目:version/name/scenes 三字段即认,scenes 数量带出", () => {
    expect(parseAnimProject('{"version":1,"name":"演示","scenes":[{},{}]}')).toEqual({ name: "演示", scenes: 2 });
  });

  it("多余字段(canvas)忽略,scenes 非数组拒绝", () => {
    expect(parseAnimProject('{"version":1,"name":"a","scenes":[],"canvas":{"width":100}}')).toEqual({ name: "a", scenes: 0 });
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
    expect(parsed).toEqual({ name: "未命名动画", scenes: 0 });
  });

  it("桩文件名 = p_anim_<base36 时间>_<短随机>.json", () => {
    expect(stubProjectFileName(0xabc12, "w9x2")).toBe(`p_anim_${(0xabc12).toString(36)}_w9x2.json`);
  });
});

describe("buildAnimSessionPrompt", () => {
  it("指令语义:协议材料/目标项目以随附引用表述,路径不入正文", () => {
    const prompt = buildAnimSessionPrompt();
    expect(prompt).toContain("随附引用文件");
    expect(prompt).toContain("pnpm anim validate");
    expect(prompt).not.toContain("/.tmd-anim/protocol/schema.md");
  });

  it("小黑风格指路 + 三类活例按需提及(对齐 tmd-anim 0.1.9 投递面)", () => {
    const prompt = buildAnimSessionPrompt();
    expect(prompt).toContain("小黑");
    expect(prompt).toContain("http-example.json");
    expect(prompt).toContain("showcase-example.json");
    expect(prompt).toContain("infographic-example.json");
    expect(prompt).toContain("按需选读");
    expect(prompt).toContain("叙事配方");
  });

  it("台词断句指导:口语短句 + say 内嵌停顿命令", () => {
    const prompt = buildAnimSessionPrompt();
    expect(prompt).toContain("[[slnc 400]]");
    expect(prompt).toContain("口语短句");
  });

  it("配音语义:超长自动延长不截断(0.1.6 起),validate 带文件参数", () => {
    const prompt = buildAnimSessionPrompt();
    expect(prompt).toContain("自动延长到配音结束");
    expect(prompt).not.toContain("场景切换处截断");
    expect(prompt).toContain("pnpm anim validate <目标项目文件路径>");
  });

  it("TTS 按平台分支:默认 macOS,Windows 走 PowerShell", () => {
    expect(buildAnimSessionPrompt()).toContain("say -o /tmp/tmd-tts.aiff");
    expect(buildAnimSessionPrompt()).not.toContain("System.Speech");
    const win = buildAnimSessionPrompt(true);
    expect(win).toContain("System.Speech.Synthesis.SpeechSynthesizer");
    expect(win).not.toContain("say -o");
  });
});

describe("animSessionRefs", () => {
  const refs = animSessionRefs("/Users/u", "/Users/u/.tmd-anim/projects/p.json");

  it("协议 schema / 叙事配方 / 小黑风格包 + 目标项目,label 为 i18n 源键", () => {
    expect(refs.map((ref) => `${ref.label}:${ref.path}`)).toEqual([
      "协议 schema:/Users/u/.tmd-anim/protocol/schema.md",
      "叙事配方:/Users/u/.tmd-anim/protocol/recipes.md",
      "小黑风格配方:/Users/u/.tmd-anim/protocol/xiaohei-style.md",
      "小黑风格示例:/Users/u/.tmd-anim/protocol/xiaohei-example.json",
      "目标项目:/Users/u/.tmd-anim/projects/p.json",
    ]);
  });

  it("不再引用 tmd-anim 0.1.5+ 已停止投递的 bpe-example.json", () => {
    expect(refs.some((ref) => ref.path.includes("bpe-example"))).toBe(false);
  });
});

describe("animProjectsDir", () => {
  it("拼接 home 绝对路径", () => {
    expect(animProjectsDir("/Users/u")).toBe("/Users/u/.tmd-anim/projects");
  });
});

/* ── 「打开」平台分派(042 随手带,0.3.9 口径修订)────────────────── */

describe("animOpenAction", () => {
  it("mac = 应用 open-with;windows = 文件管理器目录定位;其余平台隐藏", () => {
    expect(animOpenAction("macos")).toBe("app");
    expect(animOpenAction("windows")).toBe("reveal");
    expect(animOpenAction("linux")).toBeNull();
    expect(animOpenAction("unknown")).toBeNull();
  });
});
