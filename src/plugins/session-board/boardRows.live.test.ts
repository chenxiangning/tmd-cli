/**
 * mergeLive 生产序回归:boardRows 模块在静态 import 期求值(先于任何插件
 * activate 的 registerCliProfile),profileById 若在模块顶层冻结,活会话
 * (running/idle 两道)永远上不了板。
 * 契约:profile 注册晚于 boardRows import,mergeLive 仍须产出活会话行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";
import type { Workspace } from "@kernel/workspace";

const sessions: SessionMeta[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      const id = `pty-${sessions.length + 1}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 1000 + sessions.length };
    }),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
    sessionResize: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

/* 静态 import:boardRows 在此刻求值模块级状态(与生产 bundle 同序)。 */
import { mergeLive } from "./boardRows";
import { host } from "@kernel/host";

const PROFILE_ID = "probe-live";
const profile: CliProfile = {
  id: PROFILE_ID,
  name: "probe",
  command: "true",
  args: [],
  triggers: [],
};

const ws: Workspace = { id: "ws1", name: "p", root: "/proj", createdAt: 0 } as Workspace;

describe("mergeLive 生产序:profile 注册晚于 boardRows 模块求值", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    sessions.length = 0;
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("activate 期注册的 profile,活会话须上板(idle 态)", async () => {
    const s = await host.createSession(PROFILE_ID, "/proj");
    const rows = mergeLive([ws], false, {}, []);
    expect(rows.map((r) => r.hostId)).toContain(s.id);
    expect(rows[0]?.st).toBe("idle");
  });

  it("孤儿活会话:全部视图收,单工作区视图滤掉", async () => {
    const s = await host.createSession(PROFILE_ID, "/elsewhere");
    expect(mergeLive([ws], true, {}, []).map((r) => r.hostId)).toContain(s.id);
    expect(mergeLive([ws], false, {}, []).map((r) => r.hostId)).not.toContain(s.id);
  });
});
