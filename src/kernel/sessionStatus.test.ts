/**
 * SessionStatusWatch 会话状态机契约测试(种子/观测/巡航)。
 * 覆盖契约:
 * - seed:成功写状态 + 来源 "seeded" + notify;无会话/缺 readDefaultStatus/
 *   读失败/已有状态一律不写不重种;竞态防线 —— await 期间会话移除或观测已
 *   落地(身份绑定/statuses 已有)时种子不得回写。
 * - refresh:无会话/身份未绑定/缺 readSessionStatus/读失败均 no-op 不抛;
 *   成功走 applyObserved 且探测收到 (cwd, cliSessionId)。
 * - applyObserved:死会话防写;tail 缺省字段保留旧值;模型变更时 thinking
 *   不跨代延续;值相等仍翻转 seeded→observed 并 notify;同值幂等不 notify。
 * - ensurePolling:单例计时器;2s 周期;tick 分派(已绑定→refresh、
 *   pending→tryBindIdentity、远程→refreshRemote);resetTimerForTest 后停摆。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CliProfile } from "./cli";
import { SessionStatusWatch } from "./sessionStatus";

const SID = "s1";
const CWD = "/proj";
const PID = "omp";

/** 手动决议的延迟探测,用于驱动 seed/refresh 的 await 窗口竞态。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

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
}

/** 最小 host fake:会话/身份绑定/活跃态全可控,notify 计数断言重渲染触发。 */
function makeHost(profile: CliProfile = makeProfile()): FakeHost {
  const sessions = new Map<string, { profileId: string; cwd: string }>();
  const cliIds = new Map<string, string>();
  const pending = new Set<string>();
  let active: string | null = null;
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
  };
}

function addSession(h: FakeHost, profile = makeProfile()): void {
  h.sessions.set(SID, { profileId: profile.id, cwd: CWD });
}

describe("seed(创建即种子)", () => {
  it("成功:写入状态 + 来源 seeded + notify 一次", async () => {
    const h = makeHost(makeProfile({
      readDefaultStatus: async () => ({ model: "m-default", thinkingLevel: "high" }),
    }));
    addSession(h);
    const w = new SessionStatusWatch(h);
    await w.seed(SID);
    expect(w.get(SID)).toEqual({ model: "m-default", thinkingLevel: "high" });
    expect(w.source(SID)).toBe("seeded");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
  it("无会话 / profile 缺 readDefaultStatus:不写不 notify", async () => {
    const h = makeHost(); // 默认 profile 无 readDefaultStatus
    const w = new SessionStatusWatch(h);
    await w.seed(SID);
    addSession(h);
    await w.seed(SID);
    expect(w.get(SID)).toBeUndefined();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each([
    ["reject", async () => { throw new Error("boom"); }],
    ["返回 null", async () => null],
  ])("读默认配置失败(%s):吞错不写不抛", async (_name, impl) => {
    const h = makeHost(makeProfile({ readDefaultStatus: impl }));
    addSession(h);
    const w = new SessionStatusWatch(h);
    await expect(w.seed(SID)).resolves.toBeUndefined();
    expect(w.get(SID)).toBeUndefined();
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("已有状态时幂等:不再探测、不再 notify(含已观测态不被种子覆盖)", async () => {
    const readDefault = vi.fn(async () => ({ model: "m-default" }));
    const h = makeHost(makeProfile({ readDefaultStatus: readDefault }));
    addSession(h);
    const w = new SessionStatusWatch(h);
    w.applyObserved(SID, { model: "m-real" });
    await w.seed(SID);
    await w.seed(SID);
    expect(w.get(SID)?.model).toBe("m-real");
    expect(w.source(SID)).toBe("observed");
    expect(readDefault).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledTimes(1); // 仅 applyObserved 那次
  });
  it("竞态:await 期间会话移除或身份已绑定,种子不得回写", async () => {
    for (const mutate of [
      (h: FakeHost) => h.sessions.delete(SID),
      (h: FakeHost) => h.cliIds.set(SID, "cli-1"),
    ]) {
      const d = deferred<{ model: string }>();
      const h = makeHost(makeProfile({ readDefaultStatus: () => d.promise }));
      addSession(h);
      const w = new SessionStatusWatch(h);
      const pending = w.seed(SID);
      mutate(h); // await 窗口内:会话移除 / 观测通道就绪
      d.resolve({ model: "late" });
      await pending;
      expect(w.get(SID)).toBeUndefined();
      expect(h.notify).not.toHaveBeenCalled();
    }
  });
});

describe("refresh(磁盘尾窗观测)", () => {
  it("无会话 / 身份未绑定 / 缺 readSessionStatus:no-op 不探测", async () => {
    const read = vi.fn(async () => ({ model: "m" }));
    const h = makeHost(makeProfile({ readSessionStatus: read }));
    const w = new SessionStatusWatch(h);
    await w.refresh(SID); // 会话不存在
    addSession(h);
    await w.refresh(SID); // 身份未绑定
    expect(read).not.toHaveBeenCalled();
    expect(w.get(SID)).toBeUndefined();
    const bare = new SessionStatusWatch(makeHost()); // profile 缺 readSessionStatus
    await bare.refresh(SID);
    expect(w.get(SID)).toBeUndefined();
  });
  it("探测返回 null 或 reject:吞错不写不 notify", async () => {
    const h = makeHost(makeProfile({ readSessionStatus: async () => null }));
    addSession(h);
    h.cliIds.set(SID, "cli-1");
    const w = new SessionStatusWatch(h);
    await w.refresh(SID);
    h.sessions.delete(SID);
    addSession(h, makeProfile({
      readSessionStatus: async () => { throw new Error("boom"); },
    }));
    await expect(w.refresh(SID)).resolves.toBeUndefined();
    expect(w.get(SID)).toBeUndefined();
    expect(h.notify).not.toHaveBeenCalled();
  });
  it("成功:探测收到 (cwd, cliSessionId),观测落地 + 来源 observed + notify", async () => {
    const read = vi.fn(async () => ({ model: "m-obs", thinkingLevel: "low" }));
    const h = makeHost(makeProfile({ readSessionStatus: read }));
    addSession(h);
    h.cliIds.set(SID, "cli-1");
    const w = new SessionStatusWatch(h);
    await w.refresh(SID);
    expect(read).toHaveBeenCalledWith(CWD, "cli-1");
    expect(w.get(SID)).toEqual({ model: "m-obs", thinkingLevel: "low" });
    expect(w.source(SID)).toBe("observed");
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
});

describe("applyObserved(字段级合并与来源翻转)", () => {
  function observedHost() {
    const h = makeHost();
    addSession(h);
    return { h, w: new SessionStatusWatch(h) };
  }

  it("死会话防写:回包不给已移除会话写状态", () => {
    const { h, w } = observedHost();
    w.applyObserved(SID, { model: "m" });
    h.sessions.delete(SID);
    w.applyObserved(SID, { model: "m2" });
    expect(w.get(SID)).toEqual({ model: "m" }); // 停在移除前旧值,m2 不得落表
  });
  it("全新观测:写入 model+thinking,来源 observed", () => {
    const { w } = observedHost();
    w.applyObserved(SID, { model: "m1", thinkingLevel: "high" });
    expect(w.get(SID)).toEqual({ model: "m1", thinkingLevel: "high" });
    expect(w.source(SID)).toBe("observed");
  });
  it("同模型 tail 缺省字段保留旧值(滚出窗口≠被清除),同值幂等不 notify", () => {
    const { h, w } = observedHost();
    w.applyObserved(SID, { model: "m1", thinkingLevel: "high" });
    w.applyObserved(SID, { model: "m1" }); // thinking 滚出尾窗
    expect(w.get(SID)).toEqual({ model: "m1", thinkingLevel: "high" });
    w.applyObserved(SID, { model: "m1", thinkingLevel: "high" }); // 完全同值
    expect(h.notify).toHaveBeenCalledTimes(1); // 后两次合并无变化不重渲染
  });
  it("model 缺省时保留旧 model,thinking 仍按观测推进", () => {
    const { w } = observedHost();
    w.applyObserved(SID, { model: "m1" });
    w.applyObserved(SID, { thinkingLevel: "low" });
    expect(w.get(SID)).toEqual({ model: "m1", thinkingLevel: "low" });
  });
  it("模型变更:缺省 thinking 不跨代延续;带新 thinking 则新值生效", () => {
    const { w } = observedHost();
    w.applyObserved(SID, { model: "m1", thinkingLevel: "high" });
    w.applyObserved(SID, { model: "m2" });
    expect(w.get(SID)?.model).toBe("m2");
    expect(w.get(SID)?.thinkingLevel).toBeUndefined(); // 宁显 — 不冒充观测
    w.applyObserved(SID, { model: "m3", thinkingLevel: "low" });
    expect(w.get(SID)).toEqual({ model: "m3", thinkingLevel: "low" });
  });
  it("值相等仍翻转 seeded→observed 并 notify(「默认」角标靠来源摘除)", async () => {
    const h = makeHost(makeProfile({
      readDefaultStatus: async () => ({ model: "m-same", thinkingLevel: "high" }),
    }));
    addSession(h);
    const w = new SessionStatusWatch(h);
    await w.seed(SID); // 先完成种子,再观测同值:验证翻转而非覆盖
    expect(w.source(SID)).toBe("seeded");
    w.applyObserved(SID, { model: "m-same", thinkingLevel: "high" });
    expect(w.get(SID)).toEqual({ model: "m-same", thinkingLevel: "high" });
    expect(w.source(SID)).toBe("observed");
    expect(h.notify).toHaveBeenCalledTimes(2);
  });
});

describe("ensurePolling(2s 巡航分派)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function pollingHost() {
    const read = vi.fn(async () => ({ model: "m-poll" }));
    const profile = makeProfile({ readSessionStatus: read });
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
});
