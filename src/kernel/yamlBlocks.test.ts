/**
 * yamlBlocks 行级补丁契约:核心不变量 = 「只动目标行,其余字节逐字保留」;
 * setMap/setList 为期望全量替换语义;被改写行的行内注释保留。
 * fixture 用本机 ~/.omp/agent/config.yml 真实快照(2026-09-09)。
 */
import { describe, expect, it } from "vitest";
import {
  getList,
  getMap,
  getScalar,
  setList,
  setMap,
  setScalar,
  unquoteScalar,
} from "./yamlBlocks";

const SNAPSHOT = `modelRoles:
  smol: minimax-code-cn/MiniMax-M3:high
  default: zhipu-coding-plan/glm-5.3-flash:max
symbolPreset: unicode
setupVersion: 2
retry:
  fallbackChains:
    default:
      - minimax-code-cn/MiniMax-M3:high
defaultThinkingLevel: auto
dev:
  autoqaConsent: granted
memory:
  backend: "off"
compaction:
  enabled: false
# 手写注释必须原样存活
ttsr:
  enabled: true
  interruptMode: always
webSearch:
  providerChain: [exa, gemini]
`;

const L = SNAPSHOT.split("\n");

describe("读取", () => {
  it("顶层/嵌套标量 + 引号与行内注释剥离", () => {
    expect(getScalar(L, ["symbolPreset"])).toBe("unicode");
    expect(getScalar(L, ["memory", "backend"])).toBe("off");
    expect(getScalar(L, ["setupVersion"])).toBe("2");
    expect(getScalar(L, ["nope"])).toBe("");
  });

  it("unquoteScalar:引号内的 # 不当注释,引号外的剥", () => {
    expect(unquoteScalar('1234 # 注释"引号内"')).toBe("1234");
    expect(unquoteScalar('"a # b"')).toBe("a # b");
    expect(unquoteScalar("'x #'")).toBe("x #");
    expect(unquoteScalar("abc#def")).toBe("abc#def");
  });

  it("modelRoles 全角色 map", () => {
    expect(getMap(L, ["modelRoles"])).toEqual([
      ["smol", "minimax-code-cn/MiniMax-M3:high"],
      ["default", "zhipu-coding-plan/glm-5.3-flash:max"],
    ]);
  });

  it("块列表与 flow 内联列表", () => {
    expect(getList(L, ["retry", "fallbackChains", "default"])).toEqual([
      "minimax-code-cn/MiniMax-M3:high",
    ]);
    expect(getList(L, ["webSearch", "providerChain"])).toEqual(["exa", "gemini"]);
  });
});

describe("写回:字节保真", () => {
  it("setMap 全量替换:同名原位改、多余键删、注释/未知段不动", () => {
    const out = setMap(L, ["modelRoles"], [
      ["smol", "minimax-code-cn/MiniMax-M3:high"],
      ["default", "kimi-code/k3:max"],
    ]);
    const text = out.join("\n");
    expect(text).toContain("  default: kimi-code/k3:max\n");
    expect(text).toContain("  smol: minimax-code-cn/MiniMax-M3:high\n");
    expect(text).toContain("# 手写注释必须原样存活");
    expect(text).toContain("  autoqaConsent: granted");
    // 除目标行外逐字一致
    expect(out.filter((l) => !l.startsWith("  default:"))).toEqual(
      L.filter((l) => !l.startsWith("  default:")),
    );
  });

  it("setMap 删多余键 + 缺失键追加,不重复建块", () => {
    const out = setMap(L, ["modelRoles"], [
      ["default", "a/b"],
      ["slow", "c/d:low"],
    ]);
    expect(getMap(out, ["modelRoles"])).toEqual([
      ["default", "a/b"],
      ["slow", "c/d:low"],
    ]);
    expect(out.join("\n").match(/^modelRoles:$/gm)?.length).toBe(1);
  });

  it("setMap 对 flow-map 头整行转块写法,产出合法 YAML", () => {
    const flow = "modelRoles: {smol: a/b, default: c/d}\nsymbolPreset: unicode\n";
    const out = setMap(flow.split("\n"), ["modelRoles"], [["smol", "x/y"]]);
    const text = out.join("\n");
    expect(text).toContain("modelRoles:\n  smol: x/y");
    expect(text).not.toContain("{smol: a/b");
    expect(text).toContain("symbolPreset: unicode");
  });

  it("setScalar 保留被改行的行内注释", () => {
    const noted = SNAPSHOT.replace('  backend: "off"', '  backend: "off" # 本机备注');
    const out = setScalar(noted.split("\n"), ["memory", "backend"], "mnemopi");
    expect(out.join("\n")).toContain("  backend: mnemopi # 本机备注");
    expect(getScalar(out, ["memory", "backend"])).toBe("mnemopi");
  });

  it("setList 全量替换块列表;flow 内联保持内联风格", () => {
    const out = setList(L, ["retry", "fallbackChains", "default"], ["x/y:high", "p/q"]);
    expect(getList(out, ["retry", "fallbackChains", "default"])).toEqual(["x/y:high", "p/q"]);
    expect(out.join("\n")).toContain("      - x/y:high\n");
    const flow = setList(L, ["webSearch", "providerChain"], ["exa", "gemini"]);
    expect(flow.join("\n")).toContain("  providerChain: [exa, gemini]");
    expect(setList(L, ["webSearch", "providerChain"], ["exa", "gemini"]).join("\n")).toBe(
      SNAPSHOT,
    );
  });

  it("setScalar 布尔/歧义串格式正确", () => {
    const on = setScalar(L, ["compaction", "enabled"], true);
    expect(getScalar(on, ["compaction", "enabled"])).toBe("true");
    const mem = setScalar(L, ["memory", "backend"], "off");
    expect(mem.join("\n")).toContain('  backend: "off"');
    // 幂等:再读再写不变
    expect(setScalar(mem, ["memory", "backend"], "off").join("\n")).toBe(mem.join("\n"));
  });

  it("缺失顶层键插到文件尾;缺失中间键逐级新建;空文件建块", () => {
    const out = setScalar(L, ["symbolPreset2"], "ascii");
    expect(out.join("\n").trimEnd().endsWith("symbolPreset2: ascii")).toBe(true);
    const chain = setList(L, ["webSearch", "fallbackChain"], ["exa"]);
    expect(getList(chain, ["webSearch", "fallbackChain"])).toEqual(["exa"]);
    const brand = setMap([], ["retry", "fallbackChains"], [["smol", "a/b"]]);
    expect(getMap(brand, ["retry", "fallbackChains"])).toEqual([["smol", "a/b"]]);
  });

  it("往返:读出 → 原样写回 = 恒等(全托管键)", () => {
    expect(setMap(L, ["modelRoles"], getMap(L, ["modelRoles"])).join("\n")).toBe(SNAPSHOT);
    expect(
      setList(
        L,
        ["retry", "fallbackChains", "default"],
        getList(L, ["retry", "fallbackChains", "default"]),
      ).join("\n"),
    ).toBe(SNAPSHOT);
    expect(
      setScalar(L, ["compaction", "enabled"], getScalar(L, ["compaction", "enabled"]) === "true").join(
        "\n",
      ),
    ).toBe(SNAPSHOT);
  });
});
