/**
 * memory-coordinator 协议/目录/配置模型 契约(并测 modelCatalog、console/engineConfigModel):
 * protocol —— CATEGORY_ORDER 按 12 类注入优先级 0..11 连续编序;harnessLabel 仅
 *   "pi" 显示为 "pi/omp",其余原样;NATIVE_INJECT_PROFILES 仅 omp/pi/opencode 豁免;
 *   projectIdentityFromRootCommit 恒带 git: 前缀。
 * modelCatalog —— resolveDistillEngine 只认 omp/pi/opencode,未知/空回落 omp;
 *   listModels:omp 走 models list --json,空 models 字段/非零退出/抛错 → 空数组;
 *   条目缺省归一(selector 回落 provider/id、contextWindow 缺省 0、reasoning 仅 true);
 *   opencode 逐行 selector 文本,仅含 "/" 的行入表;pi 无列表命令恒空;
 *   10 分钟缓存(未过期直接回缓存,force 绕过),失败结果同样进缓存。
 * engineConfigModel —— readEngineConfig 语义经 read/write 文件面验证:模型从
 *   block.pi/omp.model 取,嵌套字符串;sidekick 缺块=禁用,写回不产 sidekick;
 *   注释保留(jsonc 回写底座)、缺 omp 回退 pi.model、embeddingEnabled 恒 true;
 *   读文件失败(不存在)→ 空配置。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const procCommunicate = vi.hoisted(() => vi.fn());
const fsReadFile = vi.hoisted(() => vi.fn());
const fsWriteFile = vi.hoisted(() => vi.fn());
const configHomeDir = vi.hoisted(() => vi.fn(async () => "/home/u"));

vi.mock("@kernel/ipc", () => ({
  ipc: { procCommunicate, fsReadFile, fsWriteFile, configHomeDir },
}));

import {
  CATEGORY_CN,
  CATEGORY_ORDER,
  NATIVE_INJECT_PROFILES,
  harnessLabel,
  projectIdentityFromRootCommit,
} from "./protocol";
import { listModels, resolveDistillEngine } from "./modelCatalog";
import { readEngineConfigFile, writeEngineConfigFile } from "./console/engineConfigModel";

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("protocol", () => {
  it("CATEGORY_ORDER 为 12 类连续 0..11 注入优先级,中文名一一齐备", () => {
    const keys = Object.keys(CATEGORY_ORDER);
    expect(keys).toHaveLength(12);
    expect(Object.values(CATEGORY_ORDER)).toEqual([...Array(12).keys()]);
    expect(Object.keys(CATEGORY_CN).sort()).toEqual([...keys].sort());
    expect(CATEGORY_ORDER["PROJECT_RULES"]).toBeLessThan(CATEGORY_ORDER["CONSTRAINTS"]);
    expect(CATEGORY_CN["KNOWN_ISSUES"]).toBe("已知问题");
  });

  it("harnessLabel 仅 pi 显示 pi/omp,其余原样透传", () => {
    expect(harnessLabel("pi")).toBe("pi/omp");
    expect(harnessLabel("codex")).toBe("codex");
    expect(harnessLabel("")).toBe("");
  });

  it("原生注入豁免只含 omp/pi/opencode", () => {
    expect(NATIVE_INJECT_PROFILES).toEqual({ omp: true, pi: true, opencode: true });
  });

  it("项目身份恒为 git:<rootCommit>", () => {
    expect(projectIdentityFromRootCommit("abc123")).toBe("git:abc123");
    expect(projectIdentityFromRootCommit("")).toBe("git:");
  });
});

describe("resolveDistillEngine", () => {
  it("合法引擎原样,未知/空回落 omp", () => {
    expect(resolveDistillEngine("omp")).toBe("omp");
    expect(resolveDistillEngine("pi")).toBe("pi");
    expect(resolveDistillEngine("opencode")).toBe("opencode");
    expect(resolveDistillEngine("codex")).toBe("omp");
    expect(resolveDistillEngine("")).toBe("omp");
  });
});

describe("listModels", () => {
  it("omp:JSON 解析 + 条目缺省归一", async () => {
    procCommunicate.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        models: [
          { selector: "zai/glm-5", name: "GLM-5", provider: "zai", contextWindow: 200000, reasoning: true },
          { provider: "zai", id: "glm-air" },
          { selector: "x/y", reasoning: "yes" },
        ],
      }),
      stderr: "",
    });
    const entries = await listModels("omp", true);
    expect(procCommunicate).toHaveBeenCalledWith(
      expect.objectContaining({ command: "omp", args: ["models", "list", "--json"] }),
    );
    expect(entries).toEqual([
      { selector: "zai/glm-5", name: "GLM-5", provider: "zai", contextWindow: 200000, reasoning: true },
      { selector: "zai/glm-air", name: "glm-air", provider: "zai", contextWindow: 0, reasoning: false },
      { selector: "x/y", name: "", provider: "", contextWindow: 0, reasoning: false },
    ]);
  });

  it("omp:非零退出或非法 stdout → 空数组且仍进缓存", async () => {
    procCommunicate.mockResolvedValue({ code: 1, stdout: "", stderr: "boom" });
    await expect(listModels("omp", true)).resolves.toEqual([]);
    procCommunicate.mockClear();
    await expect(listModels("omp")).resolves.toEqual([]);
    expect(procCommunicate).not.toHaveBeenCalled();
  });

  it("omp:抛错(引擎缺席)→ 空数组不外抛", async () => {
    procCommunicate.mockRejectedValue(new Error("spawn omp"));
    await expect(listModels("omp", true)).resolves.toEqual([]);
  });

  it("opencode:逐行 selector,仅含 / 的行入表", async () => {
    procCommunicate.mockResolvedValue({
      code: 0,
      stdout: "zai/glm-5\n\nanthropic/claude\n  openai/gpt  \nnotaselector\n",
      stderr: "",
    });
    const entries = await listModels("opencode", true);
    expect(procCommunicate).toHaveBeenCalledWith(
      expect.objectContaining({ command: "opencode", args: ["models"] }),
    );
    expect(entries).toEqual([
      { selector: "zai/glm-5", name: "zai/glm-5", provider: "zai", contextWindow: 0, reasoning: false },
      { selector: "anthropic/claude", name: "anthropic/claude", provider: "anthropic", contextWindow: 0, reasoning: false },
      { selector: "openai/gpt", name: "openai/gpt", provider: "openai", contextWindow: 0, reasoning: false },
    ]);
  });

  it("pi:无列表命令,恒空且不发进程调用", async () => {
    await expect(listModels("pi", true)).resolves.toEqual([]);
    expect(procCommunicate).not.toHaveBeenCalled();
  });

  it("10 分钟内命中缓存,force 绕过重新拉取", async () => {
    procCommunicate.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ models: [{ selector: "a/b" }] }),
    });
    await listModels("omp", true);
    procCommunicate.mockClear();
    await listModels("omp");
    expect(procCommunicate).not.toHaveBeenCalled();
    await listModels("omp", true);
    expect(procCommunicate).toHaveBeenCalledTimes(1);
  });
});

describe("engineConfigModel", () => {
  const ORIGINAL = `{
    // 保留注释
    "theme": "dark",
    "historian": { "pi": { "model": "old-pi" } },
  }`;

  it("读:模型取 block.pi/omp.model;sidekick 缺块=禁用;embedding 恒开", async () => {
    fsReadFile.mockResolvedValue(ORIGINAL);
    const { config } = await readEngineConfigFile();
    expect(config).toEqual({
      historianModel: "old-pi",
      dreamerModel: "",
      sidekickModel: "",
      sidekickEnabled: false,
      embeddingEnabled: true,
    });
  });

  it("读:文件不存在 → 空配置不外抛", async () => {
    fsReadFile.mockRejectedValue(new Error("ENOENT"));
    const { config, original } = await readEngineConfigFile();
    expect(original).toBe("");
    expect(config.historianModel).toBe("");
    expect(config.sidekickEnabled).toBe(false);
  });

  it("写:pi 为基座 omp 同步、opencode 独立、jsonc 注释保留、sidekick 关闭不写块", async () => {
    fsReadFile.mockResolvedValue(ORIGINAL);
    const { config, original } = await readEngineConfigFile();
    await writeEngineConfigFile(
      { ...config, historianModel: "zai/glm-5", dreamerModel: "zai/air" },
      original,
    );
    expect(fsWriteFile).toHaveBeenCalledTimes(1);
    const [path, text] = fsWriteFile.mock.calls[0];
    expect(path).toBe("/home/u/.config/cortexkit/magic-context.jsonc");
    const out = JSON.parse(text);
    expect(out.theme).toBe("dark");
    expect(text.endsWith("\n")).toBe(true);
    expect(out.historian).toEqual({ pi: { model: "zai/glm-5" }, omp: { model: "zai/glm-5" }, opencode: { model: "zai/glm-5" } });
    expect(out.dreamer.opencode.model).toBe("zai/air");
    expect(out.sidekick).toBeUndefined();
  });

  it("写:sidekick 开启时三个 harness 块齐写", async () => {
    await writeEngineConfigFile(
      {
        historianModel: "h",
        dreamerModel: "d",
        sidekickModel: "s",
        sidekickEnabled: true,
        embeddingEnabled: true,
      },
      null,
    );
    const out = JSON.parse(fsWriteFile.mock.calls[0][1]);
    expect(out.sidekick).toEqual({
      pi: { model: "s" },
      omp: { model: "s" },
      opencode: { model: "s" },
    });
  });

  it("写:historian 缺 omp 时回退已有 pi.model,不丢既有字段", async () => {
    await writeEngineConfigFile(
      { historianModel: "", dreamerModel: "", sidekickModel: "", sidekickEnabled: false, embeddingEnabled: true },
      JSON.stringify({ historian: { pi: { model: "keep" }, extra: 1 } }),
    );
    const out = JSON.parse(fsWriteFile.mock.calls[0][1]);
    expect(out.historian).toEqual({
      pi: { model: "" },
      omp: { model: "" },
      opencode: { model: "" },
      extra: 1,
    });
  });
});
