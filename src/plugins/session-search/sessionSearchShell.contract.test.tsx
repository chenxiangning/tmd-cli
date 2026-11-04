/**
 * D-03 session-search 入口契约 —— search 启停分流矩阵:
 * - search 启用:不注册自家 overlay(统一壳唯一浮层,无双遮罩);命令打开
 *   search 统一壳(kind="sessions");
 * - search 禁用:注册原壳 overlay;命令打开自家浮层;
 * - 无活动工作区:命令双路都不开门。
 * 两个浮层 store 均真模块(模块级单例,本文件内一致);settings/workspace
 * 以可变形组部分 mock。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@kernel/plugin";

const { disabled, wsState, overlays } = vi.hoisted(() => ({
  disabled: [] as string[],
  wsState: { ws: { id: "ws1", root: "/a" } as { id: string; root: string } | null },
  overlays: [] as string[],
}));

vi.mock("@kernel/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kernel/settings")>();
  return {
    ...actual,
    getSettingsState: () => ({ settings: { disabledPlugins: disabled, language: "zh" } }),
  };
});
vi.mock("@kernel/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kernel/workspace")>();
  return { ...actual, getActiveWorkspace: () => wsState.ws };
});

import { sessionSearchPlugin } from "./index";
import { closeSessionSearch, sessionSearchOpen } from "./overlayStore";
import { closeSearchOverlay, searchOverlayKind } from "@plugins/search/overlayStore";

function collectingCtx(commands: Map<string, () => void>) {
  return {
    registerCommand: (c: { id: string; run: () => void }) => commands.set(c.id, c.run),
    contribute: (slot: string, c: { component: unknown }) => {
      if (slot === "overlay") overlays.push("overlay");
      void c;
    },
    events: { on: () => () => {}, off: () => {}, emit: () => {} },
  } as unknown as PluginContext;
}

beforeEach(() => {
  disabled.length = 0;
  overlays.length = 0;
  wsState.ws = { id: "ws1", root: "/a" };
  closeSessionSearch();
  closeSearchOverlay();
});

describe("session-search 入口分流", () => {
  it("search 启用:不注册自家 overlay,命令打开统一壳 sessions", () => {
    const commands = new Map<string, () => void>();
    sessionSearchPlugin.activate(collectingCtx(commands));
    expect(overlays).toHaveLength(0);
    commands.get("session-search.open")!();
    expect(searchOverlayKind()).toBe("sessions");
  });

  it("search 禁用:注册原壳 overlay,命令打开自家浮层", () => {
    disabled.push("search");
    const commands = new Map<string, () => void>();
    sessionSearchPlugin.activate(collectingCtx(commands));
    expect(overlays).toEqual(["overlay"]);
    commands.get("session-search.open")!();
    expect(sessionSearchOpen()).toBe(true);
    closeSessionSearch();
  });

  it("无活动工作区:命令双路都不开门", () => {
    wsState.ws = null;
    const commands = new Map<string, () => void>();
    sessionSearchPlugin.activate(collectingCtx(commands));
    commands.get("session-search.open")!();
    expect(sessionSearchOpen()).toBe(false);
  });
});
