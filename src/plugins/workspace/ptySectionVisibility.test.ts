/**
 * ptySectionVisibility 契约(PTY 小节头聚合 store,2026-11-06 回归钉):
 * 键 = `${workspaceId}:${profileId}` —— 组按工作区×引擎双维挂载(折叠卡
 * children 常驻 inert),单 profileId 键曾被空工作区的组覆写,有行工作区的
 * 小节头莫名消失。钉死:同工作区同引擎一组一键;跨工作区同名引擎互不串写;
 * 同值写静默不提交(快照引用不变);读侧快照引用稳定。
 * 手法:store 是模块级单例,经 vi.resetModules + 动态 import 取全新实例
 * (测试刻意演练模块加载边界,静态 import 拿不到干净单例)。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./ptySectionVisibility");
let mod: Mod;

const load = async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./ptySectionVisibility");
};

afterEach(() => {
  vi.resetModules();
});

describe("ptySectionVisibility", () => {
  it("跨工作区同名引擎互不串写:B 组写 false 不遮 A 组的小节头", async () => {
    await load();
    mod.notePtyGroupVisible("ws-a", "omp", true);
    mod.notePtyGroupVisible("ws-b", "omp", false);
    const snap = mod.ptyVisibilitySnapshot();
    expect(snap.get(mod.ptyVisibilityKey("ws-a", "omp"))).toBe(true);
    expect(snap.get(mod.ptyVisibilityKey("ws-b", "omp"))).toBe(false);
  });

  it("同工作区同引擎覆写生效;同值写静默(快照引用不变,读侧零扰)", async () => {
    await load();
    mod.notePtyGroupVisible("ws-a", "omp", true);
    const snap = mod.ptyVisibilitySnapshot();
    mod.notePtyGroupVisible("ws-a", "omp", true);
    expect(mod.ptyVisibilitySnapshot()).toBe(snap);
    mod.notePtyGroupVisible("ws-a", "omp", false);
    expect(mod.ptyVisibilitySnapshot().get(mod.ptyVisibilityKey("ws-a", "omp"))).toBe(false);
  });
});
