/**
 * archiveExitedSession(退出即归档)契约:
 * - 干净退出(有归属工作区 + 有稳定身份 + 尾巴已读)→ 写归档标记;
 * - 尾巴未读 → 跳过(结束-未查看道保留注意力);
 * - 无稳定身份 / 无归属工作区 → 跳过(sessionArchive 契约:无稳定身份不可归档);
 * - 真实 host 走法:emit 时活表仍可查(removeRoom 异步未完成,checkpoints 同序)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kernel/ipc";
import type { CliProfile } from "@kernel/cli";

const sessions: SessionMeta[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(
      async (profileId: string, spec: { cwd: string }, workspaceId?: string) => {
        const id = `pty-${sessions.length + 1}`;
        sessions.push({ id, profileId, cwd: spec.cwd, workspaceId } as SessionMeta);
        return { id, pid: 1000 + sessions.length };
      },
    ),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
    sessionResize: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));
import { sessionBoardPlugin } from "./index";
import type { PluginContext } from "@kernel/plugin";
import { host } from "@kernel/host";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { KernelTopics } from "@kernel/events";
import { sessionArchiveKey } from "@kernel/sessionArchive";
import { archiveExitedSession } from "./boardExit";

const PROFILE_ID = "probe-exit";
const profile: CliProfile = {
  id: PROFILE_ID,
  name: "probe",
  command: "true",
  args: [],
  triggers: [],
};

function stubIo(over: {
  workspaceId?: string;
  cliId?: string;
  unread?: boolean;
}) {
  return {
    getSessions: () => [{ id: "s1", profileId: PROFILE_ID, workspaceId: over.workspaceId }],
    getCliSessionId: () => over.cliId,
    isUnread: () => over.unread ?? false,
  };
}

describe("archiveExitedSession 退出即归档", () => {
  beforeEach(() => {
    sessions.length = 0;
    updateSettings({ sessionArchive: {} });
    if (!host.getCliProfile(PROFILE_ID)) host.registerCliProfile(profile);
  });

  it("干净退出 → 写归档标记(键 = 工作区:引擎:磁盘身份)", () => {
    archiveExitedSession("s1", stubIo({ workspaceId: "ws-1", cliId: "cli-9" }));
    expect(
      getSettingsState().settings.sessionArchive[sessionArchiveKey("ws-1", PROFILE_ID, "cli-9")],
    ).toBeDefined();
  });

  it("尾巴未读 → 跳过(结束-未查看道保留注意力)", () => {
    archiveExitedSession("s1", stubIo({ workspaceId: "ws-1", cliId: "cli-9", unread: true }));
    expect(getSettingsState().settings.sessionArchive).toEqual({});
  });

  it("无稳定身份 / 无归属工作区 → 跳过", () => {
    archiveExitedSession("s1", stubIo({ workspaceId: "ws-1" }));
    archiveExitedSession("s1", stubIo({ cliId: "cli-9" }));
    archiveExitedSession("missing", stubIo({ workspaceId: "ws-1", cliId: "cli-9" }));
    expect(getSettingsState().settings.sessionArchive).toEqual({});
  });

  it("真实 host 走法:插件订阅 + emit sessionExited → 标记落盘", async () => {
    /* 真 activate(桩 ctx):经 ctx.events 挂上与生产同款的订阅布线。 */
    sessionBoardPlugin.activate({
      contribute: () => undefined,
      registerSidebarAction: () => undefined,
      events: host.events,
    } as unknown as PluginContext);
    const meta = await host.createSession(PROFILE_ID, "/proj", "ws-real");
    host.bindIdentityForTest(meta.id, "cli-real");
    /* emit 早于移除完成(生产序),此刻活表与身份账本仍可查。 */
    host.events.emit(KernelTopics.sessionExited, meta.id);
    expect(
      getSettingsState().settings.sessionArchive[
        sessionArchiveKey("ws-real", PROFILE_ID, "cli-real")
      ],
    ).toBeDefined();
  });
});
