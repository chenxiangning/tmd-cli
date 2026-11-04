/**
 * archiveExitedSession(退出即归档)契约 —— 2026-11-04 自 session-board 迁入:
 * - 干净退出(有归属工作区 + 有稳定身份 + 尾巴已读)→ 写归档标记;
 * - 尾巴未读 → 跳过(结束-未查看道保留注意力);
 * - 无稳定身份 / 无归属工作区 → 跳过(sessionArchive 契约:无稳定身份不可归档);
 * - 订阅责任在 workspace 插件 activate(不看板 UI 是否在场),deactivate 退订后不再写。
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
    sessionSize: vi.fn(async () => null),
    /* activate 链的 loadSessionPresets 软依赖:缺文件 = 空库,不告警。 */
    configHomeDir: vi.fn(async () => "/tmp/tmd-test-config"),
    fsReadFile: vi.fn(async () => {
      throw new Error("os error 2");
    }),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));
import { workspacePlugin } from "./index";
import type { PluginContext } from "@kernel/plugin";
import { host } from "@kernel/host";
import { getSettingsState, updateSettings } from "@kernel/settings";
import { KernelTopics } from "@kernel/events";
import { sessionArchiveKey } from "@kernel/sessionArchive";
import { archiveExitedSession } from "./sessionExitArchive";

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

function activateWorkspaceEvents(): () => void {
  /* 真 activate(桩 ctx):经 ctx.events 挂上与生产同款的订阅布线。 */
  const off = workspacePlugin.activate({
    contribute: () => undefined,
    registerCommand: () => undefined,
    registerSettingsSection: () => undefined,
    events: host.events,
  } as unknown as PluginContext);
  return typeof off === "function" ? off : () => {};
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

  it("重复退出事件幂等:同一键只一份,不重复建档", () => {
    archiveExitedSession("s1", stubIo({ workspaceId: "ws-1", cliId: "cli-9" }));
    archiveExitedSession("s1", stubIo({ workspaceId: "ws-1", cliId: "cli-9" }));
    expect(Object.keys(getSettingsState().settings.sessionArchive)).toHaveLength(1);
  });

  it("真实 host 走法:workspace 订阅 + emit sessionExited → 标记落盘", async () => {
    const deactivate = activateWorkspaceEvents();
    const meta = await host.createSession(PROFILE_ID, "/proj", "ws-real");
    host.bindIdentityForTest(meta.id, "cli-real");
    /* emit 早于移除完成(生产序),此刻活表与身份账本仍可查。 */
    host.events.emit(KernelTopics.sessionExited, meta.id);
    expect(
      getSettingsState().settings.sessionArchive[
        sessionArchiveKey("ws-real", PROFILE_ID, "cli-real")
      ],
    ).toBeDefined();
    deactivate();
  });

  it("deactivate 退订后:再 emit 不新增归档(无幽灵写)", async () => {
    const deactivate = activateWorkspaceEvents();
    deactivate(); /* 拔出:订阅应随 cleanup 退订 */
    const meta = await host.createSession(PROFILE_ID, "/proj", "ws-real");
    host.bindIdentityForTest(meta.id, "cli-real");
    host.events.emit(KernelTopics.sessionExited, meta.id);
    expect(getSettingsState().settings.sessionArchive).toEqual({});
  });
});
