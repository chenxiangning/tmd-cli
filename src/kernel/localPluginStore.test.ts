/**
 * 本地插件状态表(localPluginStore)契约测试。
 * 覆盖契约:
 * - emit 重建快照:records 变更经 emit 后 getLocalPluginRecords 可见(增删皆然)。
 * - 快照引用稳定:两次 emit 之间返回同一数组引用(useSyncExternalStore getSnapshot
 *   缓存语义,引用不稳 React 会无限重渲染),emit 后换新引用。
 * - subscribeLocalPlugins:emit 通知订阅者;退订后不再通知。
 * - __resetLocalPluginStoreForTests 测试接缝:records 与快照一并清空。
 * 模块级单例:全程用测试接缝复位,不依赖文件加载顺序。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  emit,
  getLocalPluginRecords,
  records,
  subscribeLocalPlugins,
  __resetLocalPluginStoreForTests,
  type LocalPluginRecord,
} from "./localPluginStore";

function mkRec(id: string): LocalPluginRecord {
  return {
    id,
    origin: "local",
    manifest: null,
    meta: null,
    contentHash: null,
    manifestHash: null,
    permissions: null,
    versions: [],
    error: null,
    activateError: null,
    activatedHash: null,
    removed: false,
  };
}

beforeEach(() => {
  __resetLocalPluginStoreForTests();
});

describe("emit 快照重建", () => {
  it("记录增删经 emit 后对快照可见", () => {
    expect(getLocalPluginRecords()).toEqual([]);
    records.set("a", mkRec("a"));
    emit();
    expect(getLocalPluginRecords().map((r) => r.id)).toEqual(["a"]);
    records.delete("a");
    emit();
    expect(getLocalPluginRecords()).toEqual([]);
  });

  it("快照引用两次 emit 之间稳定,emit 后换新引用", () => {
    const s1 = getLocalPluginRecords();
    const s2 = getLocalPluginRecords();
    expect(s1).toBe(s2);
    records.set("a", mkRec("a"));
    emit();
    expect(getLocalPluginRecords()).not.toBe(s1);
  });
});

describe("subscribeLocalPlugins 订阅", () => {
  it("emit 通知订阅者,退订后不再通知", () => {
    let hits = 0;
    const unsub = subscribeLocalPlugins(() => {
      hits += 1;
    });
    emit();
    expect(hits).toBe(1);
    unsub();
    emit();
    expect(hits).toBe(1);
  });
});

describe("__resetLocalPluginStoreForTests 测试接缝", () => {
  it("records 与快照一并清空", () => {
    records.set("a", mkRec("a"));
    emit();
    expect(getLocalPluginRecords()).toHaveLength(1);
    __resetLocalPluginStoreForTests();
    expect(records.size).toBe(0);
    expect(getLocalPluginRecords()).toEqual([]);
  });
});
