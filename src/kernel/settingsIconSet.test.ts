/**
 * 图标组合(iconSet)清洗契约测试 —— 模式同 settingsIconDecor.test.ts。
 * 覆盖:出厂默认 classic、合法值透传、非法值回落、磁盘读取无字段回落/有字段透传。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "./settings";

const ipcMock = vi.hoisted(() => ({
  configReadSettings: vi.fn(),
  configMergeSettings: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

/** 被测单例的测试可见面(结构化,避免内联 typeof import 注解)。 */
let settings: {
  getSettingsState: () => { loaded: boolean; settings: AppSettings };
  updateSettings: (patch: Partial<AppSettings>) => void;
  ensureSettingsBooted: () => void;
};

beforeEach(async () => {
  vi.clearAllMocks();
  ipcMock.configReadSettings.mockResolvedValue(null);
  ipcMock.configMergeSettings.mockResolvedValue(undefined);
  vi.resetModules();
  settings = (await import("./settings")) as unknown as typeof settings;
});

describe("图标组合设置", () => {
  it("出厂默认 classic(组合1 现状)", () => {
    expect(settings.getSettingsState().settings.iconSet).toBe("classic");
  });

  it("合法值透传:solid / metaphor / lucide / lucide-alt", () => {
    settings.updateSettings({ iconSet: "solid" });
    expect(settings.getSettingsState().settings.iconSet).toBe("solid");
    settings.updateSettings({ iconSet: "metaphor" });
    expect(settings.getSettingsState().settings.iconSet).toBe("metaphor");
    settings.updateSettings({ iconSet: "lucide" });
    expect(settings.getSettingsState().settings.iconSet).toBe("lucide");
    settings.updateSettings({ iconSet: "lucide-alt" });
    expect(settings.getSettingsState().settings.iconSet).toBe("lucide-alt");
  });

  it("非法值回落 classic", () => {
    settings.updateSettings({ iconSet: "bogus" as unknown as AppSettings["iconSet"] });
    expect(settings.getSettingsState().settings.iconSet).toBe("classic");
  });

  it("磁盘读取:存量无字段回落 classic;有字段透传", async () => {
    ipcMock.configReadSettings.mockResolvedValue({});
    settings.ensureSettingsBooted();
    await vi.waitFor(() => expect(settings.getSettingsState().settings.iconSet).toBe("classic"));

    ipcMock.configReadSettings.mockResolvedValue({ iconSet: "metaphor" });
    vi.resetModules();
    settings = (await import("./settings")) as unknown as typeof settings;
    settings.ensureSettingsBooted();
    await vi.waitFor(() => expect(settings.getSettingsState().settings.iconSet).toBe("metaphor"));
  });
});
