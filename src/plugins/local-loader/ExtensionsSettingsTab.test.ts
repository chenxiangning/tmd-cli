/**
 * 设置面板「打开插件市场」行为契约:先执行市场命令、再关闭设置面板(防遮挡);
 * 命令缺失时二者都不动作。mock 命令注册表与设置面板,helper 真件。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const shortcutsMock = vi.hoisted(() => ({
  commands: [] as Array<{ id: string; run: ReturnType<typeof vi.fn> }>,
  getCommands: () => shortcutsMock.commands,
  useCommands: () => shortcutsMock.commands,
}));
vi.mock("@kernel/shortcuts", () => shortcutsMock);

const settingsMock = vi.hoisted(() => ({ closeSettingsPanel: vi.fn() }));
vi.mock("@kernel/settings", () => settingsMock);

import { closeSettingsPanel } from "@kernel/settings";
import { openPluginMarketFromSettings } from "./openPluginMarketFromSettings";

const closePanel = vi.mocked(closeSettingsPanel);

describe("openPluginMarketFromSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shortcutsMock.commands = [];
  });

  it("命令存在:执行市场命令并关闭设置面板", () => {
    const run = vi.fn();
    shortcutsMock.commands = [{ id: "shell.openMarket", run }];
    openPluginMarketFromSettings();
    expect(run).toHaveBeenCalledTimes(1);
    expect(closePanel).toHaveBeenCalledTimes(1);
  });

  it("命令缺失:不执行任何动作", () => {
    openPluginMarketFromSettings();
    expect(closePanel).not.toHaveBeenCalled();
  });
});
