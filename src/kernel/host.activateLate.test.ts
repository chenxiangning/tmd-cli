/**
 * activateLate 晚激活契约测试(本地插件「待启用→确认」免重启通道)。
 * 契约:以首轮已激活集合为依赖底座;重复 id / 依赖缺失 / 被拔插件一律拒绝;
 * 激活成功即 notify(注册表响应式上屏)。
 * host 单例 activation 记忆化 —— 本文件独占一个模块实例(vitest 文件级隔离)。
 */
import { describe, expect, it, vi } from "vitest";
import type { Plugin } from "./plugin";

vi.mock("./ipc", () => ({
  ipc: {},
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

vi.mock("./settings", () => ({
  getSettingsState: () => ({
    settings: { disabledPlugins: ["p-pulled"] },
  }),
  subscribeSettings: () => () => {},
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

describe("activateLate 晚激活", () => {
  it("首轮完成后可晚激活;重复/缺依赖/被拔拒绝;成功即 notify", async () => {
    await host.activateAll([mkPlugin("p-base")]);
    expect(activated).toEqual(["p-base"]);

    let notified = 0;
    const un = host.subscribe(() => {
      notified += 1;
    });

    await host.activateLate(mkPlugin("p-late", ["p-base"]));
    expect(activated).toEqual(["p-base", "p-late"]);
    expect(host.isPluginActive("p-late")).toBe(true);
    expect(notified).toBeGreaterThan(0);

    /* 重复激活同 id → 拒绝,不二次执行 activate。 */
    await expect(host.activateLate(mkPlugin("p-late"))).rejects.toThrow("已激活");
    expect(activated.filter((x) => x === "p-late")).toHaveLength(1);

    /* 依赖缺失 → 拒绝。 */
    await expect(host.activateLate(mkPlugin("p-orphan", ["p-never"]))).rejects.toThrow(
      "依赖缺失",
    );
    expect(host.isPluginActive("p-orphan")).toBe(false);

    /* 被拔插件 → 拒绝(防御:UI 门控之外的兜底)。 */
    await expect(host.activateLate(mkPlugin("p-pulled"))).rejects.toThrow("拔出");
    expect(activated).not.toContain("p-pulled");

    un();
  });
});
