/**
 * refreshRemoteStatus 契约(远程引擎会话状态观测):
 * 返回 false = 非远程形态(会话不存在 / profile 缺 remoteSessions / 工作区
 * 不存在 / 来源缺 remoteExec),调用方落回本地观测,零副作用。
 * 返回 true = 已按远程形态处理:
 * - 已绑定 cliSessionId:直接 readStatus(exec, cwd, cliId),observed 非空才
 *   applyObserved;不触碰 list/bindIdentity/notify。
 * - 未绑定:自带远程身份绑定 —— remote.list(exec, cwd) 里取 createdAt ≥
 *   会话创建-5s 的最早条目;绑定成功则 notify 后按新身份读状态;
 *   尚无远端落盘(无候选)或绑定失败 → 只回 true,不读状态;
 *   list 拒绝按空表处理(懒 flush 巡航,不抛)。
 * readStatus 未声明或回 null → 不 applyObserved,仍回 true。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CliProfile, RemoteExec } from "./cli";
import type { SessionMeta } from "./ipc";
import { refreshRemoteStatus } from "./remoteStatusRefresh";

const exec = { kind: "stub-exec" } as unknown as RemoteExec;
const WS = { id: "ws1", name: "repo", root: "/repo", createdAt: 1 };

/* workspace / workspaceOrigins 是模块级注册表,惰性读桩变量注入假来源。 */
let mockWorkspaces: Array<typeof WS>;
let mockOrigin: {
  id: string;
  matches: (ws: unknown) => boolean;
  remoteExec?: (ws: unknown) => RemoteExec | null;
} | null;

vi.mock("./workspace", () => ({
  getWorkspaces: () => mockWorkspaces,
}));
vi.mock("./workspaceOrigins", () => ({
  findWorkspaceOrigin: () => mockOrigin,
}));

function makeSession(patch: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: "s1",
    profileId: "p1",
    cwd: "/repo",
    workspaceId: "ws1",
    createdAt: 10_000,
    ...patch,
  };
}

interface Status {
  model?: string;
  thinkingLevel?: string;
}

function makeDeps(session: SessionMeta | undefined, profile: CliProfile) {
  return {
    findSession: vi.fn(() => session),
    getCliProfile: vi.fn(() => profile),
    getCliSessionId: vi.fn<() => string | undefined>(() => undefined),
    bindIdentity: vi.fn(() => true),
    applyObserved: vi.fn(),
    notify: vi.fn(),
  };
}

function remoteProfile(
  list: () => Promise<Array<{ id: string; createdAt?: number }>>,
  readStatus?: (exec: RemoteExec, cwd: string, cliId: string) => Promise<Status | null>,
): CliProfile {
  return {
    id: "p1",
    remoteSessions: {
      list: () => list(),
      ...(readStatus ? { readStatus } : {}),
    },
  } as unknown as CliProfile;
}

beforeEach(() => {
  mockWorkspaces = [WS];
  mockOrigin = {
    id: "origin-ssh",
    matches: () => true,
    remoteExec: () => exec,
  };
});

describe("非远程形态 → false 且零副作用", () => {
  it.each([
    ["会话不存在", () => makeDeps(undefined, remoteProfile(async () => []))],
    [
      "profile 缺 remoteSessions",
      () => makeDeps(makeSession(), { id: "p1" } as CliProfile),
    ],
    [
      "工作区不存在",
      () => {
        mockWorkspaces = [];
        return makeDeps(makeSession(), remoteProfile(async () => []));
      },
    ],
    [
      "来源缺 remoteExec",
      () => {
        mockOrigin = { id: "origin-local", matches: () => true };
        return makeDeps(makeSession(), remoteProfile(async () => []));
      },
    ],
  ])("%s", async (_name, make) => {
    const deps = make();
    await expect(refreshRemoteStatus(deps, "s1")).resolves.toBe(false);
    expect(deps.applyObserved).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe("已绑定身份:直达读状态", () => {
  it("readStatus(exec, cwd, cliId) 命中 → applyObserved,不重走绑定", async () => {
    const status = { model: "gpt-x" };
    const deps = makeDeps(
      makeSession(),
      remoteProfile(
        () => {
          throw new Error("不应重扫列表");
        },
        async (e, cwd, cliId) => {
          expect([e, cwd, cliId]).toEqual([exec, "/repo", "cli-1"]);
          return status;
        },
      ),
    );
    deps.getCliSessionId = vi.fn(() => "cli-1");
    await expect(refreshRemoteStatus(deps, "s1")).resolves.toBe(true);
    expect(deps.applyObserved).toHaveBeenCalledWith("s1", status);
    expect(deps.bindIdentity).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it("readStatus 未声明或回 null:不 applyObserved,仍算远程形态", async () => {
    const none = makeDeps(makeSession(), remoteProfile(async () => []));
    none.getCliSessionId = vi.fn(() => "cli-1");
    await expect(refreshRemoteStatus(none, "s1")).resolves.toBe(true);
    expect(none.applyObserved).not.toHaveBeenCalled();

    const nulled = makeDeps(
      makeSession(),
      remoteProfile(async () => [], async () => null),
    );
    nulled.getCliSessionId = vi.fn(() => "cli-1");
    await expect(refreshRemoteStatus(nulled, "s1")).resolves.toBe(true);
    expect(nulled.applyObserved).not.toHaveBeenCalled();
  });
});

describe("未绑定身份:远程身份绑定", () => {
  it("候选按 createdAt ≥ 创建-5s 过滤并取最早者;绑定成功 → notify + 读状态", async () => {
    const rows = [
      { id: "too-old", createdAt: 4_999 },
      { id: "early", createdAt: 5_000 },
      { id: "late", createdAt: 20_000 },
    ];
    const deps = makeDeps(
      makeSession(),
      remoteProfile(
        async () => rows,
        async (_e, _cwd, cliId) => ({ model: `m-${cliId}` }),
      ),
    );
    await expect(refreshRemoteStatus(deps, "s1")).resolves.toBe(true);
    expect(deps.bindIdentity).toHaveBeenCalledWith("s1", "early");
    expect(deps.notify).toHaveBeenCalled();
    expect(deps.applyObserved).toHaveBeenCalledWith("s1", { model: "m-early" });
  });

  it("无候选(尚无远端落盘)或 list 拒绝:回 true 巡航,不绑定不读状态", async () => {
    const empty = makeDeps(makeSession(), remoteProfile(async () => []));
    await expect(refreshRemoteStatus(empty, "s1")).resolves.toBe(true);
    expect(empty.bindIdentity).not.toHaveBeenCalled();

    const rejected = makeDeps(
      makeSession(),
      remoteProfile(async () => {
        throw new Error("channel down");
      }),
    );
    await expect(refreshRemoteStatus(rejected, "s1")).resolves.toBe(true);
    expect(rejected.bindIdentity).not.toHaveBeenCalled();
    expect(rejected.applyObserved).not.toHaveBeenCalled();
  });

  it("绑定失败(竞态):回 true,不 notify 不读状态", async () => {
    const deps = makeDeps(
      makeSession(),
      remoteProfile(async () => [{ id: "cand", createdAt: 10_000 }]),
    );
    deps.bindIdentity = vi.fn(() => false);
    await expect(refreshRemoteStatus(deps, "s1")).resolves.toBe(true);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.applyObserved).not.toHaveBeenCalled();
  });
});
