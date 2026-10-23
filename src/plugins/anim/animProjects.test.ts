/**
 * anim 项目文件面纯函数测试 —— 最小解析容错、桩文件名、初始 prompt 要点。
 */

import { describe, expect, it } from "vitest";
import {
  animOpenAction,
  animProjectsDir,
  animSessionRefs,
  buildAnimSessionPrompt,
  cachedAnimProject,
  classifyProjectReadError,
  invalidateAnimProjectCache,
  isAnimProjectFile,
  parseAnimProject,
  projectReadErrorMessage,
  putAnimProjectCache,
  readAnimProjectRows,
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

/* ── 读失败归因(fs_read_bytes_base64 报错形态,不猜)────────────────── */

describe("classifyProjectReadError", () => {
  it("超限形态(Rust 读取闸原文)= oversize", () => {
    expect(classifyProjectReadError("文件超过 32MB 读取上限")).toBe("oversize");
  });

  it("ENOENT(io Display 恒带 os error 2)= deleted;tauri 字符串与 Error 形态同归", () => {
    expect(classifyProjectReadError("读取文件信息失败: No such file or directory (os error 2)")).toBe("deleted");
    expect(classifyProjectReadError(new Error("读取文件信息失败: No such file or directory (os error 2)"))).toBe("deleted");
  });

  it("其余(权限/非文件/未知对象)= io,不猜", () => {
    expect(classifyProjectReadError("读取文件失败: Permission denied (os error 13)")).toBe("io");
    expect(classifyProjectReadError("读取文件失败: Too many open files (os error 24)")).toBe("io");
    expect(classifyProjectReadError("读取文件失败: Is a directory (os error 21)")).toBe("io");
    expect(classifyProjectReadError("读取文件信息失败: 系统找不到指定的路径。 (os error 3)")).toBe("deleted");
    expect(classifyProjectReadError("目标路径不是文件")).toBe("io");
    expect(classifyProjectReadError({ nonsense: true })).toBe("io");
  });

  it("projectReadErrorMessage:字符串拒因原样,Error 取 message,其余 String 化", () => {
    expect(projectReadErrorMessage("boom")).toBe("boom");
    expect(projectReadErrorMessage(new Error("e1"))).toBe("e1");
    expect(projectReadErrorMessage(7)).toBe("7");
  });
});

/* ── 轮询读缓存(path+mtime 键,LRU 8)──────────────────────────────── */

describe("项目读缓存原语", () => {
  it("put/get 往返:同 mtime 命中(null = 坏内容也缓存),mtime 变即 miss", () => {
    putAnimProjectCache("/p/x.json", 1, { name: "X", scenes: 2 });
    expect(cachedAnimProject("/p/x.json", 1)).toEqual({ name: "X", scenes: 2 });
    putAnimProjectCache("/p/x.json", 2, null);
    expect(cachedAnimProject("/p/x.json", 1)).toBeUndefined();
    expect(cachedAnimProject("/p/x.json", 2)).toBeNull();
  });

  it("invalidateAnimProjectCache 删键:强制下一拍重读(显式失效路径)", () => {
    putAnimProjectCache("/p/e.json", 5, { name: "E", scenes: 0 });
    expect(cachedAnimProject("/p/e.json", 5)).toEqual({ name: "E", scenes: 0 });
    invalidateAnimProjectCache("/p/e.json");
    expect(cachedAnimProject("/p/e.json", 5)).toBeUndefined();
  });
});

describe("readAnimProjectRows 轮询读缓存", () => {
  const ok = (name: string) => JSON.stringify({ version: 1, name, scenes: [{}] });
  /** 带调用序日志的 readText 桩(读盘证据 = calls)。 */
  function reader(impl: (p: string) => Promise<string>) {
    const calls: string[] = [];
    return { calls, readText: (p: string) => { calls.push(p); return impl(p); } };
  }
  const stamp = (path: string, modifiedAt = 1, name?: string) => ({
    name: name ?? path.split("/").pop() ?? path,
    path,
    modifiedAt,
  });

  it("mtime 未变:第二拍命中缓存零读盘;mtime 变即失效重读", async () => {
    const r = reader(() => Promise.resolve(ok("A")));
    const s = stamp("/p/a.json", 100);
    expect(await readAnimProjectRows([s], r.readText)).toEqual([
      { path: "/p/a.json", file: "a.json", name: "A", scenes: 1, tooLarge: false },
    ]);
    expect(await readAnimProjectRows([s], r.readText)).toEqual([
      { path: "/p/a.json", file: "a.json", name: "A", scenes: 1, tooLarge: false },
    ]);
    expect(r.calls).toEqual(["/p/a.json"]); /* 第二拍命中,未再读盘 */
    await readAnimProjectRows([stamp("/p/a.json", 200)], r.readText);
    expect(r.calls).toEqual(["/p/a.json", "/p/a.json"]); /* mtime 变 → 重读 */
  });

  it("坏内容缓存为 null:同 mtime 不再重读解析(仍显「无效项目」)", async () => {
    const r = reader(() => Promise.resolve("{ broken"));
    const s = stamp("/p/bad.json");
    expect(await readAnimProjectRows([s], r.readText)).toEqual([
      { path: "/p/bad.json", file: "bad.json", name: null, scenes: null, tooLarge: false },
    ]);
    await readAnimProjectRows([s], r.readText);
    expect(r.calls).toEqual(["/p/bad.json"]);
  });

  it("读失败不缓存:超限行归 too-large(每拍重试),改投 IO 错误后回落「无效项目」", async () => {
    let mode: "oversize" | "io" = "oversize";
    const r = reader(() =>
      Promise.reject(mode === "oversize" ? "文件超过 32MB 读取上限" : "读取文件失败: EIO (os error 5)"),
    );
    const s = stamp("/p/big.json");
    expect(await readAnimProjectRows([s], r.readText)).toEqual([
      { path: "/p/big.json", file: "big.json", name: null, scenes: null, tooLarge: true },
    ]);
    await readAnimProjectRows([s], r.readText);
    expect(r.calls).toEqual(["/p/big.json", "/p/big.json"]); /* 失败未缓存,下一拍重试 */
    mode = "io";
    expect(await readAnimProjectRows([s], r.readText)).toEqual([
      { path: "/p/big.json", file: "big.json", name: null, scenes: null, tooLarge: false },
    ]);
  });

  it("LRU 8 级:满员后新项目逐出最旧,被逐项下一拍重读", async () => {
    const r = reader((p) => Promise.resolve(ok(p)));
    const stamps = (n: number) => Array.from({ length: n }, (_, i) => stamp(`/lru/k${i}.json`));
    await readAnimProjectRows(stamps(8), r.readText); /* 预热:顺带清走其它用例的陈旧键 */
    await readAnimProjectRows(stamps(8), r.readText);
    expect(r.calls).toHaveLength(8); /* 第二拍全命中,零读盘 */
    /* 第三拍:k0..k7 先全部命中,k9 随后入缓存把最旧的 k0 逐出 ——
     * 逐出发生在本拍命中之后,k0 的重读落在下一拍(时序注记)。 */
    await readAnimProjectRows([...stamps(8), stamp("/lru/k9.json")], r.readText);
    await readAnimProjectRows(stamps(8), r.readText);
    expect(r.calls.filter((p) => p === "/lru/k0.json")).toHaveLength(2); /* 被逐项重读一次 */
    expect(r.calls.filter((p) => p === "/lru/k1.json")).toHaveLength(1); /* 未被逐,仍零读盘 */
  });

  it("拍内消失的路径删缓存键:文件再现时重读(失效路径自愈)", async () => {
    const r = reader(() => Promise.resolve(ok("D")));
    const s = stamp("/p/d.json");
    await readAnimProjectRows([s], r.readText);
    await readAnimProjectRows([], r.readText); /* 消失 → 删键 */
    await readAnimProjectRows([s], r.readText); /* 再现 → 重读 */
    expect(r.calls).toEqual(["/p/d.json", "/p/d.json"]);
  });
});
