/**
 * pageCache 契约测试(node 环境,纯逻辑面):
 * - buildInitialProbes:命中缓存即时呈现(不落 loading),未命中才 loading;
 * - 缓存表与 state 解耦:写入缓存不改变既有读取语义。
 * 探针/凭据的重验编排入 React effect(此处不可测),只锁「缓存命中 = 无 loading 闪烁」。
 */

import { describe, expect, it, vi } from "vitest";

/* engineMetas 派生自已注册 CliProfile;node 环境注入单个假 profile。 */
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => [
      {
        id: "omp",
        name: "OMP",
        command: "omp",
        args: [],
        triggers: [],
        npmPackage: "@omp/cli",
      },
    ],
    listPluginStates: () => [],
  },
}));

import type { EngineProbeState } from "./EngineCard";
import { buildInitialProbes, probeCache } from "./pageCache";

describe("pageCache.buildInitialProbes", () => {
  it("空缓存:全部引擎落 loading(首访语义)", () => {
    probeCache.clear();
    const probes = buildInitialProbes();
    expect(Object.keys(probes).length).toBeGreaterThan(0);
    for (const state of Object.values(probes)) {
      expect(state.status).toBe("loading");
    }
  });

  it("命中缓存:直接呈现缓存值,不落 loading(回首页零闪烁)", () => {
    probeCache.clear();
    const ok: EngineProbeState = {
      status: "ok",
      result: { command: "omp", found: true, path: "/usr/local/bin/omp", version: "1.0.0", npmPrefix: null },
    };
    probeCache.set("omp", ok);
    const probes = buildInitialProbes();
    expect(probes["omp"]).toBe(ok);
  });
});
