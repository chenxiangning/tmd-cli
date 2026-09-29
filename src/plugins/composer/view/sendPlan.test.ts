/**
 * sendPlan 契约(发送二次确认数据面,spec 2026-09-27-composer-send-confirm):
 * - 目标卡字段:标题(手动命名 > 打开快照 > meta 标题 > 短码,与 tab 条同源)、
 *   工作区展示名(归属匹配失败回落 cwd 末段)、引擎展示名(profile 缺失回落 id)、
 *   平铺幕布位序(kept 序 1 起,非平铺缺省)、当前幕布标记;
 * - buildSinglePlan:会话存在 → 单发计划;不存在 → null(调用方静默不发);
 * - buildBroadcastPlan:逐目标组卡,消失的目标跳过(执行段以重解析为准,
 *   显示快照与执行解耦)。
 * host / sessionTabs / settings 以最小桩替代(与 iconDecor.test 同纪律)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMock = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  profiles: {} as Record<string, { name: string }>,
  activeId: null as string | null,
  cliIds: {} as Record<string, string>,
}));
const tabsMock = vi.hoisted(() => ({ tile: false, ids: [] as string[] }));
const titlesMock = vi.hoisted(() => ({ titles: {} as Record<string, string> }));

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => hostMock.sessions,
    getCliProfile: (id: string) => hostMock.profiles[id],
    getActiveSessionId: () => hostMock.activeId,
    getCliSessionId: (id: string) => hostMock.cliIds[id],
  },
}));
vi.mock("@kernel/sessionTabs", () => ({
  getSessionTile: () => tabsMock.tile,
  getSessionTabs: () => tabsMock.ids,
  getSessionTabTitle: () => undefined,
}));
vi.mock("@kernel/settings", () => ({
  getSettingsState: () => ({ settings: { sessionTitles: titlesMock.titles } }),
}));

import { buildBroadcastPlan, buildSinglePlan, resolveSendTarget } from "./sendPlan";

const ws = { id: "s1", profileId: "omp", cwd: "/repo/demo", title: "修复登录" };

beforeEach(() => {
  hostMock.sessions = [ws];
  hostMock.profiles = { omp: { name: "OMP" } };
  hostMock.activeId = "s1";
});
afterEach(() => {
  hostMock.sessions = [];
  hostMock.profiles = {};
  hostMock.activeId = null;
  hostMock.cliIds = {};
  tabsMock.tile = false;
  tabsMock.ids = [];
  titlesMock.titles = {};
});

describe("resolveSendTarget", () => {
  it("id/标题/工作区/引擎/位序;active 标当前幕布", () => {
    expect(resolveSendTarget(ws as never)).toEqual({
      id: "s1",
      title: "修复登录",
      workspace: "demo",
      engine: "OMP",
      active: true,
    });
  });

  it("title 缺省回落短码;profile 缺失回落 profileId", () => {
    const bare = { id: "abcdef12-3456-7890", profileId: "ghost", cwd: "/repo/x" };
    expect(resolveSendTarget(bare as never)).toEqual({
      id: "abcdef12-3456-7890",
      title: "abcd…7890",
      workspace: "x",
      engine: "ghost",
    });
  });

  it("手动命名优先于 meta 标题(与 tab 条同源)", () => {
    hostMock.cliIds = { s1: "cli-1" };
    titlesMock.titles = { "omp:cli-1": "手动名" };
    expect(resolveSendTarget(ws as never).title).toBe("手动名");
  });
});

describe("buildSinglePlan", () => {
  it("会话存在 = 单发计划(结构化目标卡)", () => {
    expect(buildSinglePlan("s1", "hello")).toEqual({
      kind: "single",
      targets: [{ id: "s1", title: "修复登录", workspace: "demo", engine: "OMP", active: true }],
      content: "hello",
    });
  });

  it("平铺态位序按 kept 序 1 起;非平铺缺省", () => {
    expect(buildSinglePlan("s1", "h")!.targets[0].paneIndex).toBeUndefined();
    tabsMock.tile = true;
    tabsMock.ids = ["s2", "s1"];
    expect(buildSinglePlan("s1", "h")!.targets[0].paneIndex).toBe(2);
  });

  it("会话不存在 = null(静默不发)", () => {
    expect(buildSinglePlan("gone", "hello")).toBeNull();
  });
});

describe("buildBroadcastPlan", () => {
  it("逐目标组卡;消失目标跳过", () => {
    hostMock.sessions = [ws, { id: "s2", profileId: "omp", cwd: "/repo/demo2" }];
    expect(buildBroadcastPlan(["s1", "gone", "s2"], "hi")).toEqual({
      kind: "broadcast",
      targets: [
        { id: "s1", title: "修复登录", workspace: "demo", engine: "OMP", active: true },
        { id: "s2", title: "s2", workspace: "demo2", engine: "OMP" },
      ],
      content: "hi",
    });
  });
});
