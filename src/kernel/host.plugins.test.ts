/**
 * host 插件激活过滤契约测试(插件市场"拔插"语义)。
 * 契约:activateAll 等 settings 首载后按 disabledPlugins 过滤 ——
 * 被拔出的插件不激活;依赖被拔插件的 dependent 一并跳过(防御性兜底);
 * listPluginStates 返回全量清单 × 启用态(含未激活的 disabled 项)。
 *
 * host 是全局单例且 activation 记忆化(只允许激活一轮),
 * 故全部断言收敛在单个用例的一次 activateAll 里。
 */
import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "./plugin";

vi.mock("./ipc", () => ({
  ipc: {},
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

/* settings 桩:disabledPlugins 落盘值必须在 activateAll 过滤时可见。 */
vi.mock("./settings", () => ({
  getSettingsState: () => ({
    settings: { disabledPlugins: ["p-disabled"] },
  }),
  settingsReady: Promise.resolve(),
}));

import { host } from "./host";

const activated: string[] = [];

function mkPlugin(id: string, dependsOn?: string[]): Plugin {
  return {
    id,
    meta: { name: id, abbr: id.slice(0, 2).toUpperCase(), desc: id, category: "feature" },
    dependsOn,
    activate: () => {
      activated.push(id);
    },
  };
}

describe("activateAll 插件过滤", () => {
  it("被拔插件不激活;其 dependent 跳过;listPluginStates 覆盖全量清单", async () => {
    await host.activateAll([
      mkPlugin("p-a"),
      mkPlugin("p-disabled"),
      mkPlugin("p-child", ["p-disabled"]),
      mkPlugin("p-b"),
    ]);

    expect(activated).toEqual(["p-a", "p-b"]);

    expect(host.listPluginStates()).toEqual([
      { plugin: expect.objectContaining({ id: "p-a" }), enabled: true },
      { plugin: expect.objectContaining({ id: "p-disabled" }), enabled: false },
      { plugin: expect.objectContaining({ id: "p-child" }), enabled: true },
      { plugin: expect.objectContaining({ id: "p-b" }), enabled: true },
    ]);
  });
});
