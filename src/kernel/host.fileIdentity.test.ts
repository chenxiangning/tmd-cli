/**
 * 内容证据身份绑定(readSessionFileIdentity)回归测试 ——
 * 自 host.sessionStatus.test.ts 拆出(文件规模铁则收紧至 300 行)。
 * fixture 与 host.test.ts 同构:同一 ipc mock 形状 + 可控 listSessions 实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "./ipc";
import type { CliDiskSession, CliProfile } from "./cli";

let spawnSeq = 0;
const sessions: SessionMeta[] = [];

vi.mock("./ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async (profileId: string, spec: { cwd: string }) => {
      spawnSeq += 1;
      const id = `pty-${spawnSeq}`;
      sessions.push({ id, profileId, cwd: spec.cwd } as SessionMeta);
      return { id, pid: 1000 + spawnSeq };
    }),
    sessionList: vi.fn(async () => sessions),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { host } from "./host";

const PROFILE_ID = "test-omp";
const CWD = "/proj";

/** 磁盘会话列表(可变,模拟 CLI 陆续落盘;mtime 倒序 = 新文件在前)。 */
let disk: CliDiskSession[] = [];

/** listSessions 的可控实现:模拟快照失败等异常路径。 */
let listImpl: () => Promise<CliDiskSession[]> = async () => disk;

function diskSession(id: string, modifiedAt = 0): CliDiskSession {
  return { id, path: `/dir/${id}.jsonl`, modifiedAt } as CliDiskSession;
}
function resetStatusTimer(): void {
  host.resetStatusTimerForTest();
}
/** 确定性驱动探测器(内部 500ms 轮询):逐格推进假时钟直到绑定或窗口耗尽。 */
async function advanceUntilBound(sessionId: string): Promise<string | undefined> {
  for (let i = 0; i < 35; i++) {
    await vi.advanceTimersByTimeAsync(500);
    const bound = host.getCliSessionId(sessionId);
    if (bound) return bound;
  }
  return undefined;
}
describe("内容证据身份绑定(readSessionFileIdentity)", () => {
  const ID_PROFILE_ID = `${PROFILE_ID}-identity`;
  const ID_CWD = `${CWD}/identity`;
  /** path → 自证身份(可变,模拟 CLI 懒落盘后文件内容可读)。 */
  let identities: Record<string, { id: string; cwd?: string; createdAt?: number } | null> = {};

  const identityProfile: CliProfile = {
    id: ID_PROFILE_ID,
    name: "test-identity",
    command: "true",
    args: [],
    triggers: [],
    listSessions: () => listImpl(),
    readSessionStatus: async () => null,
    readSessionFileIdentity: async (path) => identities[path] ?? null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetStatusTimer(); // 巡航 interval 跨用例残留旧假时钟句柄,换届时必须重置
    sessions.length = 0;
    disk = [];
    identities = {};
    if (!host.getCliProfile(ID_PROFILE_ID)) host.registerCliProfile(identityProfile);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("实证互换回归:两个懒落盘文件都在对方 spawn 后出生,按 createdAt 各归其位", async () => {
    /* 复刻 2026-09-03 omp 时间线:两会话同 cwd 相隔 68s spawn,
       文件分别在 spawn 后 94s/88s 才落盘,mtime 全落在两 spawn 之后。 */
    const a = await host.createSession(ID_PROFILE_ID, ID_CWD);
    vi.setSystemTime(68_000);
    const b = await host.createSession(ID_PROFILE_ID, ID_CWD);

    /* 94s:A 的文件出生(mtime 在 B spawn 之后 —— 旧仲裁正是因此把它判给 B);
       内容自证 createdAt = A 的 spawn 时刻 */
    vi.setSystemTime(94_000);
    identities["/dir/fA.jsonl"] = { id: "fA", cwd: ID_CWD, createdAt: 0 };
    identities["/dir/fB.jsonl"] = null;
    disk = [diskSession("fA", 94_000)];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(host.getCliSessionId(a.id)).toBe("fA");

    /* 116s:B 的文件出生;A 已认领 fA,B 只能是 fB(内容 cwd 也自证) */
    vi.setSystemTime(116_000);
    identities["/dir/fB.jsonl"] = { id: "fB", cwd: ID_CWD, createdAt: 68_000 };
    disk = [diskSession("fB", 116_000), diskSession("fA", 94_000)];
    expect(await advanceUntilBound(b.id)).toBe("fB");
  });

  it("cwd 不自证相符的文件不绑(张冠李戴防线)", async () => {
    const a = await host.createSession(ID_PROFILE_ID, ID_CWD);
    vi.setSystemTime(10_000);
    identities["/dir/fX.jsonl"] = { id: "fX", cwd: "/elsewhere", createdAt: 9_000 };
    disk = [diskSession("fX", 10_000)];
    for (let i = 0; i < 35; i++) {
      await vi.advanceTimersByTimeAsync(500);
      if (host.getCliSessionId(a.id)) break;
    }
    expect(host.getCliSessionId(a.id)).toBeUndefined();
  });
});

describe("内容证据兄弟仲裁(端到端)", () => {
  const ID_PROFILE_ID2 = "test-omp-identity";
  const ID_CWD2 = "/proj/sibling";
  let identities2: Record<string, { id: string; cwd?: string; createdAt?: number } | null> = {};

  const profile2: CliProfile = {
    id: ID_PROFILE_ID2,
    name: "test-identity",
    command: "true",
    args: [],
    triggers: [],
    listSessions: () => listImpl(),
    readSessionFileIdentity: async (path) => identities2[path] ?? null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetStatusTimer(); // 同上:慢相位巡航依赖本届假时钟的 interval
    sessions.length = 0;
    disk = [];
    identities2 = {};
    if (!host.getCliProfile(ID_PROFILE_ID2)) host.registerCliProfile(profile2);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CLI 内 resume 老会话不偷兄弟的新文件;自己的老文件迟到也能绑上", async () => {
    const a = await host.createSession(ID_PROFILE_ID2, ID_CWD2); // spawn t=0
    vi.setSystemTime(68_000);
    const b = await host.createSession(ID_PROFILE_ID2, ID_CWD2); // spawn t=68s

    /* 兄弟 B 的新文件先落盘(createdAt ≈ B 的 spawn);A 无自文件 —— 距离上
       |68k−0| 比没有近,纯评分会偷;兄弟仲裁必须让位
       (id 用例内唯一:host 单例跨用例共享认领集,见文件头注释) */
    vi.setSystemTime(100_000);
    identities2["/dir/sib-new.jsonl"] = { id: "sib-new", cwd: ID_CWD2, createdAt: 68_000 };
    disk = [diskSession("sib-new", 100_000)];
    expect(await advanceUntilBound(b.id)).toBe("sib-new");
    expect(host.getCliSessionId(a.id)).toBeUndefined();

    /* A 在 CLI 内 /resume 的老文件此刻才追加落盘(createdAt 远古):
       兄弟已绑走 sib-new(claimed 排除),A 绑自己的老文件 */
    vi.setSystemTime(150_000);
    host.setActiveSession(a.id); // 非活跃会话靠慢相位巡航(2s)
    identities2["/dir/sib-revived.jsonl"] = { id: "sib-revived", cwd: ID_CWD2, createdAt: -3_600_000 };
    disk = [diskSession("sib-revived", 150_000), diskSession("sib-new", 100_000)];
    await vi.advanceTimersByTimeAsync(4_000);
    expect(host.getCliSessionId(a.id)).toBe("sib-revived");
  });
});
