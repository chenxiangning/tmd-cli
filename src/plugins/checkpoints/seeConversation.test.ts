/**
 * resolveLedgerProfileId 契约测试:活会话 tmd id 直认、绑定 cli 身份认亲、
 * 磁盘扫描唯一认领、多引擎同 id 歧义不猜、单引擎扫描失败忽略、零命中 null。
 * kernel host 以模块 mock 提供。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hostMock = vi.hoisted(() => {
  const state = {
    sessions: [] as { id: string; profileId: string }[],
    cliOf: {} as Record<string, string>,
    profiles: [] as {
      id: string;
      listSessions?: (cwd: string) => Promise<{ id: string }[]>;
    }[],
  };
  return {
    state,
    getSessions: () => state.sessions,
    getCliSessionId: (id: string) => state.cliOf[id],
    getCliProfiles: () => state.profiles,
  };
});
vi.mock("@kernel/host", () => ({ host: hostMock }));

import { resolveLedgerProfileId } from "./seeConversation";

beforeEach(() => {
  hostMock.state.sessions = [];
  hostMock.state.cliOf = {};
  hostMock.state.profiles = [];
});

describe("resolveLedgerProfileId", () => {
  it("活会话:绑定 cli 身份认亲优先于磁盘扫描", async () => {
    hostMock.state.sessions = [{ id: "tmd-1", profileId: "omp" }];
    hostMock.state.cliOf["tmd-1"] = "cli-1";
    expect(await resolveLedgerProfileId("/w", "cli-1")).toBe("omp");
  });

  it("活会话:账本身份 = tmd id(未绑定链)直认", async () => {
    hostMock.state.sessions = [{ id: "tmd-raw", profileId: "pi" }];
    expect(await resolveLedgerProfileId("/w", "tmd-raw")).toBe("pi");
  });

  it("已关会话:磁盘扫描唯一命中认领;零命中 null", async () => {
    hostMock.state.profiles = [
      { id: "omp", listSessions: async () => [{ id: "other" }] },
      { id: "codex", listSessions: async () => [{ id: "disk-1" }, { id: "disk-2" }] },
    ];
    expect(await resolveLedgerProfileId("/w", "disk-2")).toBe("codex");
    expect(await resolveLedgerProfileId("/w", "disk-404")).toBeNull();
  });

  it("多引擎同 id 歧义不猜返回 null;单引擎扫描失败忽略", async () => {
    hostMock.state.profiles = [
      { id: "omp", listSessions: async () => [{ id: "disk-x" }] },
      { id: "codex", listSessions: async () => [{ id: "disk-x" }] },
    ];
    expect(await resolveLedgerProfileId("/w", "disk-x")).toBeNull();

    hostMock.state.profiles = [
      { id: "omp", listSessions: async () => [{ id: "disk-y" }] },
      {
        id: "codex",
        listSessions: async () => {
          throw new Error("scan fail");
        },
      },
    ];
    expect(await resolveLedgerProfileId("/w", "disk-y")).toBe("omp");
  });
});
