/**
 * 设置 section 注册表行为契约测试。
 * 唯一可脱离 React 观测的契约:重复注册即插件 bug,必须抛错。
 * (排序/快照仅经 useSettingsSections hook 暴露,node 环境无渲染器,不测。)
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import type { SettingsSectionContribution } from "./settingsRegistry";

type RegistryModule = typeof import("./settingsRegistry");

let registry: RegistryModule;

const Dummy: ComponentType = () => null;

function section(id: string): SettingsSectionContribution {
  return { id, title: id, tabs: [{ id: "t1", title: "t1", component: Dummy }] };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  registry = await import("./settingsRegistry");
});

describe("registerSettingsSection", () => {
  it("注册不同 id 不抛错", () => {
    expect(() => {
      registry.registerSettingsSection(section("basic"));
      registry.registerSettingsSection(section("advanced"));
    }).not.toThrow();
  });

  it("重复 id 视为冲突,抛错且消息含 id", () => {
    registry.registerSettingsSection(section("basic"));
    expect(() => registry.registerSettingsSection(section("basic"))).toThrow(
      /basic/,
    );
  });

  it("冲突抛错后,合法注册仍可继续(注册表未被污染)", () => {
    registry.registerSettingsSection(section("basic"));
    expect(() => registry.registerSettingsSection(section("basic"))).toThrow();
    expect(() => registry.registerSettingsSection(section("other"))).not.toThrow();
  });
});
