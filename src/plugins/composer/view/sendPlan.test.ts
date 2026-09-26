/**
 * sendPlan 契约(发送二次确认数据面,spec 2026-09-27-composer-send-confirm):
 * - 单目标行 = 会话标题(title)· 引擎显示名;title 缺省回落工作区名(根目录末段);
 *   profile 缺失回落 profileId;
 * - buildSinglePlan:会话存在 → 单发计划;不存在 → null(调用方静默不发);
 * - buildBroadcastPlan:逐目标查 meta 组行,消失的目标跳过(执行段以重解析为准,
 *   显示快照与执行解耦)。
 * host 以最小桩替代(与 iconDecor.test 同纪律)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hostMock = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
  profiles: {} as Record<string, { name: string }>,
}));

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => hostMock.sessions,
    getCliProfile: (id: string) => hostMock.profiles[id],
  },
}));

import { buildBroadcastPlan, buildSinglePlan, sendTargetLine } from "./sendPlan";

const ws = { id: "s1", profileId: "omp", cwd: "/repo/demo", title: "修复登录" };

beforeEach(() => {
  hostMock.sessions = [ws];
  hostMock.profiles = { omp: { name: "OMP" } };
});
afterEach(() => {
  hostMock.sessions = [];
  hostMock.profiles = {};
});

describe("sendTargetLine", () => {
  it("有 title 用 title,profile 缺失回落 profileId", () => {
    expect(sendTargetLine(ws as never)).toBe("修复登录 · OMP");
    expect(sendTargetLine({ ...ws, profileId: "ghost" } as never)).toBe("修复登录 · ghost");
  });

  it("title 缺省回落工作区名(根目录末段)", () => {
    const { title: _title, ...noTitle } = ws;
    expect(sendTargetLine(noTitle as never)).toBe("demo · OMP");
  });
});

describe("buildSinglePlan", () => {
  it("会话存在 = 单发计划(内容透传)", () => {
    expect(buildSinglePlan("s1", "hello")).toEqual({
      kind: "single",
      targetLines: ["修复登录 · OMP"],
      content: "hello",
    });
  });

  it("会话不存在 = null(静默不发)", () => {
    expect(buildSinglePlan("gone", "hello")).toBeNull();
  });
});

describe("buildBroadcastPlan", () => {
  it("逐目标组行;消失目标跳过", () => {
    hostMock.sessions = [ws, { id: "s2", profileId: "omp", cwd: "/repo/demo2" }];
    expect(buildBroadcastPlan(["s1", "gone", "s2"], "hi")).toEqual({
      kind: "broadcast",
      targetLines: ["修复登录 · OMP", "demo2 · OMP"],
      content: "hi",
    });
  });
});
