/**
 * tmd-sdk 虚拟模块装配契约测试(pluginSdk)。
 * 覆盖契约:
 * - installPluginShims:boot 早期一次装配三基础原语(react / react-dom / react/jsx-runtime),
 *   内容为真 React 导出(同一模块命名空间 / 同一 Fragment、jsx、jsxs 实例)。
 * - installPluginSdkShim:按插件 key 装配 tmd-sdk 实例 —— createElement/Fragment +
 *   按权限包装的 ipc/settings/host;permissions 数组去重成授权集;
 *   未声明 permissions = 纯 UI 插件,三个能力门面收到空授权集。
 * - 注册面收窄:实例键集恒为五键(React 原语 + 三能力门面),不开旁路。
 * - node 环境无 window:装配静默跳过(浏览器专属),不抛错。
 * - 逐插件装配互不覆盖:不同 key 各自独立条目。
 * pluginPermissions 走 mock(真实实现拖入 host/ipc 重依赖;包装语义由 pluginPermissions.grants.test.ts 把关)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Fragment, createElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

const h = vi.hoisted(() => ({
  wrapIpcGrants: [] as ReadonlySet<string>[],
  wrapSettingsGrants: [] as ReadonlySet<string>[],
  wrapHostGrants: [] as ReadonlySet<string>[],
}));

vi.mock("./pluginPermissions", () => ({
  wrapIpc: (grants: ReadonlySet<string>) => {
    h.wrapIpcGrants.push(grants);
    return { wrapped: "ipc" };
  },
  wrapSettings: (grants: ReadonlySet<string>) => {
    h.wrapSettingsGrants.push(grants);
    return { wrapped: "settings" };
  },
  wrapHost: (grants: ReadonlySet<string>) => {
    h.wrapHostGrants.push(grants);
    return { wrapped: "host" };
  },
}));

import { installPluginSdkShim, installPluginShims } from "./pluginSdk";

/** 当前生效的 shim 表:installPluginShims 会整体换表,断言前必须重取。 */
let shims: Record<string, Record<string, unknown>>;

/** boot 序列:先装基础原语,再把换表后的表捕获给断言用。 */
function installShims(): void {
  installPluginShims();
  shims = window.__TMD_SHIMS!;
}

beforeEach(() => {
  h.wrapIpcGrants.length = 0;
  h.wrapSettingsGrants.length = 0;
  h.wrapHostGrants.length = 0;
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installPluginShims 基础原语装配", () => {
  it("装配三基础原语且为真 React 导出", () => {
    installShims();
    expect(Object.keys(shims).sort()).toEqual(["react", "react-dom", "react/jsx-runtime"]);
    expect(shims.react).toBe(React);
    expect(shims["react-dom"]).toBe(ReactDOM);
    const jsxRuntime = shims["react/jsx-runtime"]!;
    expect(jsxRuntime.jsx).toBe(jsx);
    expect(jsxRuntime.jsxs).toBe(jsxs);
    expect(jsxRuntime.Fragment).toBe(Fragment);
  });
});

describe("installPluginSdkShim 逐插件权限装配", () => {
  it("按 key 装配五键实例;权限数组去重并同集下发三个门面", () => {
    installShims();
    installPluginSdkShim("tmd-sdk:p1:hash1", ["ipc.fs.read", "host", "ipc.fs.read"]);
    const entry = shims["tmd-sdk:p1:hash1"]!;
    expect(Object.keys(entry).sort()).toEqual([
      "Fragment",
      "createElement",
      "host",
      "ipc",
      "settings",
    ]);
    expect(entry.createElement).toBe(createElement);
    expect(entry.Fragment).toBe(Fragment);
    expect(entry.ipc).toEqual({ wrapped: "ipc" });
    expect(entry.settings).toEqual({ wrapped: "settings" });
    expect(entry.host).toEqual({ wrapped: "host" });
    for (const grants of [h.wrapIpcGrants[0], h.wrapSettingsGrants[0], h.wrapHostGrants[0]]) {
      expect([...grants!].sort()).toEqual(["host", "ipc.fs.read"]);
    }
  });

  it("纯 UI 插件:未声明 permissions,三个能力门面收到空授权集", () => {
    installShims();
    installPluginSdkShim("tmd-sdk:pure:hash", []);
    expect([...h.wrapIpcGrants[0]!]).toEqual([]);
    expect([...h.wrapSettingsGrants[0]!]).toEqual([]);
    expect([...h.wrapHostGrants[0]!]).toEqual([]);
  });

  it("逐插件装配互不覆盖:两个 key 各自独立条目", () => {
    installShims();
    installPluginSdkShim("tmd-sdk:p1:hash1", ["host"]);
    installPluginSdkShim("tmd-sdk:p2:hash2", ["ipc.util"]);
    expect(Object.keys(shims)).toHaveLength(5); // 三基础原语 + 两个 tmd-sdk 实例
    expect(shims["tmd-sdk:p1:hash1"]!.host).toEqual({ wrapped: "host" });
    expect(shims["tmd-sdk:p2:hash2"]!.ipc).toEqual({ wrapped: "ipc" });
    /* 每次装配三面各一次,授权集按该插件 permissions 下发。 */
    expect([...h.wrapHostGrants[0]!]).toEqual(["host"]);
    expect([...h.wrapIpcGrants[0]!]).toEqual(["host"]);
    expect([...h.wrapSettingsGrants[0]!]).toEqual(["host"]);
    expect([...h.wrapIpcGrants[1]!]).toEqual(["ipc.util"]);
    expect([...h.wrapHostGrants[1]!]).toEqual(["ipc.util"]);
  });
});

describe("node 环境降级", () => {
  it("无 window 时装配静默跳过不抛错", () => {
    vi.unstubAllGlobals();
    expect(() => installPluginSdkShim("tmd-sdk:x:hash", ["host"])).not.toThrow();
  });
});
