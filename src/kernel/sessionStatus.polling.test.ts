/**
 * SessionStatusWatch 巡航契约测试(ensurePolling)—— 自 sessionStatus.test.ts 拆出
 * (300 行铁则)。覆盖:单例计时器;2s 周期;tick 分派(已绑定→refresh 去重闸、
 * pending→tryBindIdentity、远程→refreshRemote);无活跃停表;失败重试;
 * resetTimerForTest 后停摆。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CliProfile } from "./cli";
import { SessionStatusWatch } from "./sessionStatus";

const SID = "s1";
const CWD = "/proj";
const PID = "omp";

function makeProfile(over: Partial<CliProfile> = {}): CliProfile {
  return { id: PID, name: PID, command: "true", args: [], triggers: [], ...over } as CliProfile;
}

/** 最小 host fake 契约:与 SessionStatusHost 结构对齐,外加测试驱动钩子。 */
interface FakeHost {
  /* 会话表/身份绑定表/pending 集:测试内动态增删,故用 Map/Set 而非静态 Record。 */
  sessions: Map<string, { profileId: string; cwd: string }>;
  cliIds: Map<string, string>; pending: Set<string>;
  notify: Mock; tryBindIdentity: Mock;
  refreshRemote: ((id: string) => Promise<boolean>) | undefined;
  setActive(id: string | null): void; getActiveSessionId(): string | null;
  findSession(id: string): { profileId: string; cwd: string } | undefined;
  hasSession(id: string): boolean; getCliProfile(): CliProfile;
  getCliSessionId(id: string): string | undefined; isPendingIdentity(id: string): boolean;
  lastOutputFrameAt(id: string): number;
  /** 测试驱动:推活动时间戳(模拟新 PTY 输出后巡航应重读)。 */
  bumpActivity(): void;
}
/** 最小 host fake:会话/身份绑定/活跃态全可控,notify 计数断言重渲染触发。 */
function makeHost(profile: CliProfile = makeProfile()): FakeHost {
  const sessions = new Map<string, { profileId: string; cwd: string }>();
  const cliIds = new Map<string, string>();
  const pending = new Set<string>();
  let active: string | null = null;
  let activity = 0;
  return {
    sessions, cliIds, pending,
    notify: vi.fn(),
    tryBindIdentity: vi.fn(async () => {}),
    refreshRemote: undefined,
    setActive: (id) => { active = id; },
    getActiveSessionId: () => active,
    findSession: (id) => sessions.get(id),
    hasSession: (id) => sessions.has(id),
    getCliProfile: () => profile,
    getCliSessionId: (id) => cliIds.get(id),
    isPendingIdentity: (id) => pending.has(id),
    lastOutputFrameAt: () => activity,
    bumpActivity: () => { activity += 1; },
  };
}
function addSession(h: FakeHost, profile = makeProfile()): void {
  h.sessions.set(SID, { profileId: profile.id, cwd: CWD });
}

describe("ensurePolling(2s 巡航分派)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function pollingHost(profileOverride?: CliProfile) {
    const read = vi.fn(async () => ({ model: "m-poll" }));
    const profile = profileOverride ?? makeProfile({ readSessionStatus: read });
    const h = makeHost(profile);
    h.setActive(SID);
    addSession(h, profile);
    const w = new SessionStatusWatch(h);
    return { h, w, read };
  }

  it("重复 ensurePolling 不叠加计时器;2s 周期到点才 refresh 分派", async () => {
    const { h, w, read } = pollingHost();
    h.cliIds.set(SID, "cli-1");
    w.ensurePolling();
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(w.get(SID)?.model).toBe("m-poll"); // 观测真实落地
    expect(h.tryBindIdentity).not.toHaveBeenCalled();
    w.resetTimerForTest();
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(1); // 复位后巡航停摆
  });
  it("无活跃会话 / 未绑定未 pending 且无远程通道:tick 均无动作", async () => {
    const { h, w, read } = pollingHost();
    h.setActive(null);
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    expect(h.tryBindIdentity).not.toHaveBeenCalled();
    h.setActive(SID); // 本地会话,未绑定、非 pending、无 refreshRemote
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    expect(h.tryBindIdentity).not.toHaveBeenCalled();
  });
  it("pending 慢相位:驱动绑定探测而非本地 refresh", async () => {
    const { h, w, read } = pollingHost();
    h.pending.add(SID);
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.tryBindIdentity).toHaveBeenCalledWith(SID);
    expect(read).not.toHaveBeenCalled();
  });
  it("远程通道:refreshRemote 接管且本地 refresh 不执行,逐周期重复", async () => {
    const { h, w, read } = pollingHost();
    const remote = vi.fn(async () => true);
    h.refreshRemote = remote;
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(remote).toHaveBeenCalledWith(SID);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(remote).toHaveBeenCalledTimes(2);
  });

  it("D 档事件化:无活跃会话 tick 即停表,重激活后巡航恢复", async () => {
    const { h, w, read } = pollingHost();
    h.setActive(null);
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000); // 首 tick 停表
    h.cliIds.set(SID, "cli-1");
    h.setActive(SID); // 激活路径(host.setActiveSession)重进 ensurePolling
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1); // 恢复后正常巡航
  });

  it("D 档事件化:活动时间戳不变则不重读,新活动后恢复逐周期读", async () => {
    const { h, w, read } = pollingHost();
    h.cliIds.set(SID, "cli-1");
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1); // 首轮读
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(1); // 空闲期不再读(旧实现每 2s 一读)
    h.bumpActivity(); // 新 PTY 输出 → 时间戳前移
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2); // 活动驱动重读
  });

  it("D 档事件化:读失败不记去重位,下轮重试", async () => {
    const read = vi.fn(async () => {
      throw new Error("boom");
    });
    const { h, w } = pollingHost(makeProfile({ readSessionStatus: read }));
    h.cliIds.set(SID, "cli-1");
    w.ensurePolling();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).toHaveBeenCalledTimes(2); // 失败未记位,巡航重试
  });
});
