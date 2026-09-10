/**
 * 权限映射穷尽性 + 包装矩阵 —— plugin-hardening 的机器把关。
 * ipc 新增方法未在 IPC_METHOD_GRANTS 登记类别(或标 null 内核保留)即本文件红。
 */
import { describe, expect, it } from "vitest";
import { ipc } from "./ipc";
import * as settingsModule from "./settings";
import {
  IPC_METHOD_GRANTS,
  PERMISSION_LABELS,
  SETTINGS_INTERNAL_KEYS,
  SETTINGS_PURE_KEYS,
  SETTINGS_READ_KEYS,
  SETTINGS_WRITE_KEYS,
  wrapHost,
  wrapIpc,
  wrapSettings,
} from "./pluginPermissions";
import { PLUGIN_PERMISSIONS } from "./plugin";

describe("IPC_METHOD_GRANTS 穷尽性", () => {
  it("ipc 每个方法都已登记(新方法必须归类或标 null 内核保留)", () => {
    for (const key of Object.keys(ipc)) {
      expect(IPC_METHOD_GRANTS[key], `ipc.${key} 未登记权限类别`).toBeDefined();
    }
  });
  it("登记表不含幽灵方法(防改名后残留)", () => {
    for (const key of Object.keys(IPC_METHOD_GRANTS)) {
      expect(ipc, `IPC_METHOD_GRANTS.${key} 在 ipc 门面上不存在`).toHaveProperty(key);
    }
  });
  it("settings 导出全部落在 读/写/保留 三组之内", () => {
    const known = new Set<string>([
      ...SETTINGS_READ_KEYS,
      ...SETTINGS_WRITE_KEYS,
      ...SETTINGS_INTERNAL_KEYS,
    ]);
    for (const key of Object.keys(settingsModule)) {
      if (known.has(key) || (SETTINGS_PURE_KEYS as readonly string[]).includes(key)) continue;
      const v = (settingsModule as unknown as Record<string, unknown>)[key];
      expect(
        typeof v === "function",
        `settings.${key} 是函数但未分组,须归 read/write/保留或登记 SETTINGS_PURE_KEYS`,
      ).toBe(false);
    }
  });
  it("每个人话文案与类别一一对应", () => {
    for (const p of PLUGIN_PERMISSIONS) {
      expect(PERMISSION_LABELS[p], `权限 ${p} 缺人话文案`).toBeTruthy();
    }
    expect(Object.keys(PERMISSION_LABELS).length).toBe(PLUGIN_PERMISSIONS.length);
  });
});

describe("wrapIpc 授权矩阵", () => {
  it("授权类别方法可用,未授权类别访问即抛并指明所需权限", () => {
    const wrapped = wrapIpc(new Set(["ipc.fs.read", "ipc.git"]));
    expect(typeof wrapped.fsReadFile).toBe("function");
    expect(typeof wrapped.gitStatus).toBe("function");
    expect(() => wrapped.sessionSpawn).toThrow(/ipc\.terminal/);
    expect(() => wrapped.quotaFetch).toThrow(/ipc\.net/);
  });
  it("内核保留能力永不放行(全授权也一样)", () => {
    const all = wrapIpc(new Set(PLUGIN_PERMISSIONS));
    expect(() => all.configReadSettings).toThrow(/内核保留/);
    expect(() => all.pluginScan).toThrow(/内核保留/);
    expect(() => all.quotaEnvValue).toThrow(/内核保留/);
  });
  it("零权限 = 纯 UI:任何能力成员访问即抛", () => {
    const none = wrapIpc(new Set());
    expect(() => none.fsReadFile).toThrow(/ipc\.fs\.read/);
    expect(() => none.md5Hex).toThrow(/ipc\.util/);
  });
});

describe("wrapSettings / wrapHost 门面", () => {
  it("settings.read 授读不授写;write 授写不授读", () => {
    const read = wrapSettings(new Set(["settings.read"]));
    expect(typeof read.getSettingsState).toBe("function");
    expect("updateSettings" in read).toBe(false);
    const write = wrapSettings(new Set(["settings.write"]));
    expect(typeof write.updateSettings).toBe("function");
    expect("getSettingsState" in write).toBe(false);
  });
  it("内部引导键(settingsReady 等)任何授权都不下发", () => {
    const all = wrapSettings(new Set(PLUGIN_PERMISSIONS));
    for (const key of SETTINGS_INTERNAL_KEYS) {
      expect(key in all).toBe(false);
    }
  });
  it("host 整面授权:未授权访问即抛,授权后可用", () => {
    expect(() => (wrapHost(new Set()) as Record<string, unknown>).getSessions).toThrow(/host/);
    expect(typeof (wrapHost(new Set(["host"])) as Record<string, unknown>).host).toBe("object");
  });
});
