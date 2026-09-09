/**
 * CLI 配置注册表行为契约 —— 镜像 settingsRegistry.test:
 * 模块级单例,vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfigEntry } from "./cliConfigRegistry";

type RegistryModule = typeof import("./cliConfigRegistry");

let registry: RegistryModule;


function entry(id: string): CliConfigEntry {
  return {
    id,
    title: id,
    sources: async () => [{ id: "global", label: id, path: `/tmp/${id}`, exists: true }],
    fields: [],
    load: () => ({}),
    save: (raw) => raw,
  };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  registry = await import("./cliConfigRegistry");
});

describe("registerCliConfig", () => {
  it("注册不同 id 不抛错", () => {
    expect(() => {
      registry.registerCliConfig(entry("omp"));
      registry.registerCliConfig(entry("pi"));
    }).not.toThrow();
  });

  it("重复 id 视为冲突,抛错且消息含 id", () => {
    registry.registerCliConfig(entry("omp"));
    expect(() => registry.registerCliConfig(entry("omp"))).toThrow(/omp/);
  });

  it("冲突抛错后,合法注册仍可继续(注册表未被污染)", () => {
    registry.registerCliConfig(entry("omp"));
    expect(() => registry.registerCliConfig(entry("omp"))).toThrow();
    expect(() => registry.registerCliConfig(entry("codex"))).not.toThrow();
  });
});
