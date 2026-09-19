/**
 * 默认设置单例契约测试(settingsDefaults.ts)。
 * 契约清单:
 * - DEFAULT_SETTINGS 覆盖 AppSettings 全部键且无 undefined 值(数据丢失防线:
 *   任一键缺失/为 undefined 都会让「部分读取」回落失败)
 * - 基础默认值钉住:主题 system、语言 zh、字体 16、缩放默认、会话页开关
 * - 五层覆盖域与映射域默认为空表/空数组(深拷贝独立,不因修改互相污染)
 * - 嵌套结构(git/ssh/wsl/sessionListBudget)形状完整
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "./settingsDefaults";

describe("DEFAULT_SETTINGS", () => {
  it("所有键均有定义值,无 undefined", () => {
    const entries = Object.entries(DEFAULT_SETTINGS);
    expect(entries.length).toBeGreaterThan(40);
    for (const [key, value] of entries) {
      expect(value, `键 ${key} 默认值不应为 undefined`).not.toBeUndefined();
    }
  });

  it("基础默认值钉住", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(DEFAULT_SETTINGS.language).toBe("zh");
    expect(DEFAULT_SETTINGS.terminalFontSize).toBe(13);
    expect(DEFAULT_SETTINGS.uiFontSize).toBe(16);
    expect(DEFAULT_SETTINGS.uiZoom).toBe(1);
    expect(DEFAULT_SETTINGS.sessionTabsMax).toBe(4);
    expect(DEFAULT_SETTINGS.sessionHygieneHours).toBe(24);
    expect(DEFAULT_SETTINGS.sessionTabsEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.sendShortcut).toBe("enter");
    expect(DEFAULT_SETTINGS.sessionHygieneEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.networkProxyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.workspaceOriginFilter).toBe("local");
  });

  it("覆盖域/映射域默认为空容器", () => {
    for (const key of [
      "sessionTitles",
      "sessionPins",
      "sessionArchive",
      "sessionDeleted",
      "sessionKeep",
      "engineVersionFavs",
      "shortcutOverrides",
      "workspaceCollapsedMap",
      "workspaceGroupCollapsedMap",
      "localPluginTrust",
    ] as const) {
      expect(DEFAULT_SETTINGS[key], key).toEqual({});
    }
    for (const key of ["disabledPlugins", "workspaceGroups"] as const) {
      expect(DEFAULT_SETTINGS[key], key).toEqual([]);
    }
  });

  it("嵌套结构形状完整", () => {
    expect(DEFAULT_SETTINGS.git).toEqual({ view: "diff", layout: "flat", diffMode: "unified", diffWrap: true });
    expect(DEFAULT_SETTINGS.ssh).toEqual({ hosts: [] });
    expect(DEFAULT_SETTINGS.wsl).toEqual({ defaultDistro: "", remoteHostId: "" });
    expect(DEFAULT_SETTINGS.sessionListBudget).toEqual({ total: 20, perCli: {} });
    expect(DEFAULT_SETTINGS.sessionOutputBufferLimit).toBe(500_000);
  });
});
