/**
 * 默认会话引擎解析契约:设置串 → 注册表校验 + 每引擎模型;
 * 未设置/失效 profile 一律 null(调用方回落,不做猜测兜底)。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettingsState: vi.fn(),
  getCliProfiles: vi.fn((): Array<{ id: string; listSessions?: unknown }> => []),
}));
vi.mock("@kernel/settings", () => ({ getSettingsState: mocks.getSettingsState }));
vi.mock("@kernel/host", () => ({ host: { getCliProfiles: mocks.getCliProfiles } }));

import { defaultEngineCandidates, resolveDefaultEngine } from "./defaultEngine";

const profiles = [
  { id: "omp", listSessions: () => undefined },
  { id: "claude", listSessions: () => undefined },
  { id: "dsh", listSessions: () => undefined },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCliProfiles.mockReturnValue(profiles);
  mocks.getSettingsState.mockReturnValue({ settings: { workbenchDefaultEngine: "", workbenchEngineModels: {} } });
});

describe("resolveDefaultEngine", () => {
  it("未设置:返回 null,调用方走既有回落路径", () => {
    expect(resolveDefaultEngine()).toBeNull();
  });

  it("已设置且 profile 存活:返回 id 与该引擎记住的模型", () => {
    mocks.getSettingsState.mockReturnValue({ settings: { workbenchDefaultEngine: "claude", workbenchEngineModels: { claude: "claude-opus-4-6" } } });
    expect(resolveDefaultEngine()).toEqual({ profileId: "claude", model: "claude-opus-4-6" });
  });

  it("模型为空串:model 省略(spawn 不传 --model,用引擎默认)", () => {
    mocks.getSettingsState.mockReturnValue({ settings: { workbenchDefaultEngine: "claude", workbenchEngineModels: { claude: "" } } });
    expect(resolveDefaultEngine()).toEqual({ profileId: "claude" });
  });

  it("profile 已失效(插件被拔出/更名):null,不猜测", () => {
    mocks.getSettingsState.mockReturnValue({ settings: { workbenchDefaultEngine: "gone", workbenchEngineModels: {} } });
    expect(resolveDefaultEngine()).toBeNull();
  });
});

describe("defaultEngineCandidates", () => {
  it("剔除 dsh 合成引擎;无 listSessions 的档位不入选", () => {
    expect(defaultEngineCandidates().map((p) => p.id)).toEqual(["omp", "claude"]);
  });
});
