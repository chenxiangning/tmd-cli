/**
 * 编辑器扩展注册表行为契约测试。
 * 覆盖:注册进快照、重复注册幂等、退订移除并触发订阅、useSyncExternalStore
 * 引用稳定。模块级单例,vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type EditorExtensionsModule = typeof import("./editorExtensions");

let mod: EditorExtensionsModule;

const factory = () => Promise.resolve(null);

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./editorExtensions");
});

describe("registerEditorExtension", () => {
  it("注册进快照,重复注册不重复入表", () => {
    const off1 = mod.registerEditorExtension(factory);
    mod.registerEditorExtension(factory);
    expect(mod.editorExtensionFactories()).toEqual([factory]);
    off1();
    expect(mod.editorExtensionFactories()).toEqual([]);
  });

  it("退订只移除自身,并通知订阅者", () => {
    const other = () => Promise.resolve(null);
    const seen: number[] = [];
    mod.subscribeEditorExtensions(() => seen.push(mod.editorExtensionFactories().length));
    const off = mod.registerEditorExtension(factory);
    mod.registerEditorExtension(other);
    off();
    expect(mod.editorExtensionFactories()).toEqual([other]);
    expect(seen).toEqual([1, 2, 1]);
  });
});
