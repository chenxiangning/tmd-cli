/**
 * pi 图形化配置契约:JSON 合并只动托管键,未知键保序保留;
 * defaultModel 两级值(provider/model)写回时拆回 defaultProvider+defaultModel;
 * 模型目录 = auth.json(登录态)× models-store.json(模型清单),登录供应商排前。
 * fixture 用 stringify 规范形态(真实文件即展开数组;恒等写回断言依赖此)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@kernel/ipc";
import { loadPiConfig, piModelCatalog, savePiConfig } from "./configGui";
import type { CliConfigValues } from "@kernel/cliConfigRegistry";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: vi.fn(async () => "/home/t"),
    fsReadFile: vi.fn(async () => ""),
  },
}));
const fsRead = vi.mocked(ipc.fsReadFile);
afterEach(() => vi.clearAllMocks());

const SETTINGS = `{
  "lastChangelogVersion": "0.85.1",
  "theme": "light",
  "defaultProvider": "kimi-coding",
  "defaultModel": "k3",
  "defaultThinkingLevel": "high",
  "packages": [
    "npm:pi-memory",
    "npm:pi-lean-ctx"
  ]
}
`;

describe("load", () => {
  it("defaultProvider+defaultModel 合并为两级值", () => {
    expect(loadPiConfig(SETTINGS)).toEqual({
      defaultModel: "kimi-coding/k3",
      defaultThinkingLevel: "high",
      theme: "light",
    });
  });

  it("空文件 = 全空值(首次创建)", () => {
    expect(loadPiConfig("")).toEqual({
      defaultModel: "",
      defaultThinkingLevel: "",
      theme: "dark",
    });
  });
});

describe("save", () => {
  const patch = (over: Partial<CliConfigValues>): string =>
    savePiConfig(SETTINGS, { ...loadPiConfig(SETTINGS), ...over } as CliConfigValues);

  it("原值写回 = 恒等", () => {
    expect(savePiConfig(SETTINGS, loadPiConfig(SETTINGS))).toBe(SETTINGS);
  });

  it("两级值拆回双键;packages/lastChangelogVersion 原样保序", () => {
    const out = patch({ defaultModel: "deepseek/deepseek-chat" });
    const o = JSON.parse(out);
    expect(o.defaultProvider).toBe("deepseek");
    expect(o.defaultModel).toBe("deepseek-chat");
    expect(o.packages).toEqual(["npm:pi-memory", "npm:pi-lean-ctx"]);
    expect(o.lastChangelogVersion).toBe("0.85.1");
    expect(Object.keys(o)).toEqual(Object.keys(JSON.parse(SETTINGS)));
  });

  it("缺斜杠 = 只写 model,provider 不动", () => {
    const out = patch({ defaultModel: "deepseek-chat" });
    const o = JSON.parse(out);
    expect(o.defaultProvider).toBe("kimi-coding");
    expect(o.defaultModel).toBe("deepseek-chat");
  });
  it("空值删双键(theme 永不为空:load 缺省 dark)", () => {
    const out = patch({ defaultModel: "" });
    const o = JSON.parse(out);
    expect(o.defaultProvider).toBeUndefined();
    expect(o.defaultModel).toBeUndefined();
  });

  it("非法 JSON 抛错(错误态由 UI 呈现,不猜)", () => {
    expect(() => savePiConfig("{oops", loadPiConfig(SETTINGS))).toThrow();
  });
});

describe("模型目录(auth × models-store)", () => {
  it("供应商×模型组装,登录的排前,无模型的供应商丢弃", async () => {
    fsRead.mockImplementation(async (path: string) => {
      if (path.endsWith("auth.json")) {
        return JSON.stringify({ "kimi-coding": { type: "api_key", key: "k" } });
      }
      if (path.endsWith("models-store.json")) {
        return JSON.stringify({
          "kimi-coding": { models: [{ id: "k3", name: "K3" }, { id: "k3-256k" }] },
          deepseek: { models: [{ id: "deepseek-chat" }] },
          empty: { models: [] },
        });
      }
      throw new Error("unexpected");
    });
    expect(await piModelCatalog()).toEqual([
      { id: "kimi-coding", authed: true, models: [{ id: "k3", label: "K3" }, { id: "k3-256k" }] },
      { id: "deepseek", authed: false, models: [{ id: "deepseek-chat" }] },
    ]);
  });

  it("目录文件缺失 → 空候选(下拉降级可输入)", async () => {
    fsRead.mockRejectedValue(new Error("ENOENT"));
    expect(await piModelCatalog()).toEqual([]);
  });
});
