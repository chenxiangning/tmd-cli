/**
 * quota 契约:
 * registerQuotaProvider / getQuotaProvider —— 按 profileId 注册与取回,
 *   同 profileId 重复注册 = 替换;未注册 = null;
 * removeQuotaProvider —— 成对增删,未注册 id 移除为安全 no-op;
 * SHORT_WINDOW_LABEL —— 窗口长标签到短标映射(5小时→5h 等),未知键 = undefined;
 * isWeeklyWindow —— 仅 7天/30天 为周级窗口,其余(含未知标签)为 false。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let mod: typeof import("./quota");

beforeEach(async () => {
  vi.resetModules();
  /* 动态 import 例外:providers 是模块级单例 Map,静态 import 会跨用例共享注册表;
     必须 resetModules 后取全新实例(范式同 terminalLinks.test.ts) */
  mod = await import("./quota");
});

import type { QuotaFetchContext, QuotaSnapshot } from "./quota";
type QuotaProvider = Parameters<typeof import("./quota")["registerQuotaProvider"]>[0];

function fakeProvider(profileId: string): QuotaProvider {
  const snap: QuotaSnapshot = {
    providerLabel: profileId,
    title: "t",
    usedLabel: "已使用",
    windows: [],
  };
  return { profileId, fetch: async (_ctx: QuotaFetchContext) => snap };
}

describe("provider 注册表", () => {
  it("注册后按 profileId 取回同一对象;未注册返回 null", () => {
    const p = fakeProvider("kimi");
    mod.registerQuotaProvider(p);
    expect(mod.getQuotaProvider("kimi")).toBe(p);
    expect(mod.getQuotaProvider("codex")).toBeNull();
  });

  it("同 profileId 重复注册替换为新 provider", () => {
    const p1 = fakeProvider("pi");
    const p2 = fakeProvider("pi");
    mod.registerQuotaProvider(p1);
    mod.registerQuotaProvider(p2);
    expect(mod.getQuotaProvider("pi")).toBe(p2);
    expect(mod.getQuotaProvider("pi")).not.toBe(p1);
  });

  it("removeQuotaProvider 移除后取回 null;移除未注册 id 不抛错", () => {
    const p = fakeProvider("omp");
    mod.registerQuotaProvider(p);
    expect(() => mod.removeQuotaProvider("ghost")).not.toThrow();
    mod.removeQuotaProvider("omp");
    expect(mod.getQuotaProvider("omp")).toBeNull();
  });
});

describe("SHORT_WINDOW_LABEL / isWeeklyWindow", () => {
  it("长标签映射短标:5小时→5h、7天→7d、1天→1d、30天→30d", () => {
    expect(mod.SHORT_WINDOW_LABEL["5小时"]).toBe("5h");
    expect(mod.SHORT_WINDOW_LABEL["7天"]).toBe("7d");
    expect(mod.SHORT_WINDOW_LABEL["1天"]).toBe("1d");
    expect(mod.SHORT_WINDOW_LABEL["30天"]).toBe("30d");
  });

  it("未知标签映射为 undefined", () => {
    expect(mod.SHORT_WINDOW_LABEL["90天"]).toBeUndefined();
  });

  it("仅 7天/30天 判定为周级窗口", () => {
    expect(mod.isWeeklyWindow("7天")).toBe(true);
    expect(mod.isWeeklyWindow("30天")).toBe(true);
    expect(mod.isWeeklyWindow("5小时")).toBe(false);
    expect(mod.isWeeklyWindow("1天")).toBe(false);
  });

  it("未知标签判定为非周级", () => {
    expect(mod.isWeeklyWindow("14天")).toBe(false);
  });
});
