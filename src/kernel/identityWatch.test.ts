/**
 * DiskIdentityWatch 行为契约测试(活会话 → CLI 磁盘身份绑定的判别边界)。
 * 覆盖契约:
 * - 文件身份判别:新增(基线外)文件绑定、删除(列表消失)不绑、改名=新文件
 *   绑新 id、内容不变(基线内既有文件)不绑;
 * - 前置闸:无 pending / 已绑定 / profile 无 listSessions / listSessions 抛错 /
 *   await 期间会话死亡 → 一律不绑;
 * - 并行 spawn 仲裁:新文件归属兄弟 spawn → 让位;无基线时老会话在
 *   BIND_DEFER_MS 窗口内优先、窗口外放行;
 * - 排他:claimed 集内的磁盘身份不绑;绑定瞬间二次校验(await 期间被抢)
 *   失败且留在 pending;绑定成功 = pending 清账 + onBound 回调;
 * - 生命周期:track/remove/has 与探测循环随清账自然终止。
 * profile/ctx 全部手写最小 fake,不碰 IPC。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { DiskIdentityWatch } from "./identityWatch";
import type { CliDiskSession, CliProfile } from "./cli";

const CWD = "/ws/demo";

const disk = (id: string, modifiedAt: number, createdAt?: number): CliDiskSession => ({
  id,
  modifiedAt,
  path: `${CWD}/${id}.jsonl`,
  ...(createdAt !== undefined ? { createdAt } : {}),
});

/** host 注入 ctx 的最小形状(与 identityWatch.DiskIdentityContext 对齐)。 */
interface TestCtx {
  getCliProfile: (id: string) => CliProfile | undefined;
  sessionAlive: (id: string) => boolean;
  isBound: (id: string) => boolean;
  claimedIds: () => Set<string>;
  onBound: (sessionId: string, cliSessionId: string) => void;
}

interface FakeDeps {
  alive: Set<string>;
  bound: Set<string>;
  claimed: Set<string>;
  onBound: (sessionId: string, cliSessionId: string) => void;
  profile?: CliProfile;
}

function makeCtx(deps: FakeDeps): TestCtx {
  return {
    getCliProfile: (id: string) => (id === "omp" ? deps.profile : undefined),
    sessionAlive: (id: string) => deps.alive.has(id),
    isBound: (id: string) => deps.bound.has(id),
    claimedIds: () => deps.claimed,
    onBound: deps.onBound,
  };
}

function makeDeps(overrides: Partial<FakeDeps> = {}): FakeDeps & { ctx: TestCtx } {
  const deps: FakeDeps = {
    alive: new Set(["s1"]),
    bound: new Set(),
    claimed: new Set(),
    onBound: vi.fn(),
    ...overrides,
  };
  return { ...deps, ctx: makeCtx(deps) };
}

/** 常用 profile:listSessions 回固定列表,不声明内容自证(走水位线兜底)。 */
function listProfile(list: CliDiskSession[] | Error): CliProfile {
  return {
    id: "omp",
    name: "omp",
    command: "omp",
    listSessions: vi.fn().mockImplementation(() =>
      list instanceof Error ? Promise.reject(list) : Promise.resolve(list),
    ),
  } as unknown as CliProfile;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* track() 会启动后台探测循环:用例结束必须清账,避免循环在 mock 复位后
 * 产生未处理 rejection 或迟到绑定。 */
const registry: DiskIdentityWatch[] = [];
const reg = (w: DiskIdentityWatch): DiskIdentityWatch => {
  registry.push(w);
  return w;
};
afterEach(() => {
  for (const w of registry) {
    w.remove("s1");
    w.remove("s2");
  }
  registry.length = 0;
});

describe("DiskIdentityWatch.tryBind 前置闸", () => {
  it("无 pending、已绑定、profile 缺 listSessions → 全部不绑", async () => {
    const d = makeDeps({ profile: listProfile([disk("a", 100)]) });
    // 无 pending:直接调 tryBind 不炸不绑
    await new DiskIdentityWatch(d.ctx).tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();

    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, null, Date.now());
    d.bound.add("s1"); // 探测期间已被绑定
    await w.tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();

    // profile 未声明 listSessions → 无数据源,不绑
    const bare = makeDeps({ profile: { id: "omp", name: "omp", command: "omp" } as CliProfile });
    const wb = reg(new DiskIdentityWatch(bare.ctx));
    wb.track("s1", "omp", CWD, null, Date.now());
    await wb.tryBind("s1");
    expect(bare.onBound).not.toHaveBeenCalled();
  });

  it("listSessions 抛错 → 静默按空列表处理,不绑", async () => {
    const d = makeDeps({ profile: listProfile(new Error("boom")) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, null, Date.now());
    await expect(w.tryBind("s1")).resolves.toBeUndefined();
    expect(d.onBound).not.toHaveBeenCalled();
  });

  it("await 期间会话死亡 → 不绑(死会话不得占用磁盘身份)", async () => {
    const d = makeDeps({ profile: listProfile([disk("a", 100)]) });
    let released = false;
    (d.profile!.listSessions as Mock).mockImplementation(async () => {
      released = true;
      return [disk("a", 100)];
    });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, null, Date.now());
    const p = w.tryBind("s1");
    d.alive.delete("s1");
    await p;
    expect(released).toBe(true);
    expect(d.onBound).not.toHaveBeenCalled();
  });
});

describe("文件身份判别边界(水位线兜底路径)", () => {
  it("新增:基线外新文件 → 绑定该 id", async () => {
    const d = makeDeps({ profile: listProfile([disk("new-1", 200)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map([["old", 100]]), 150);
    await w.tryBind("s1");
    expect(d.onBound).toHaveBeenCalledWith("s1", "new-1");
    expect(w.has("s1")).toBe(false);
  });

  it("内容不变:基线内既有文件 → 不绑(留 pending 继续巡航)", async () => {
    const d = makeDeps({ profile: listProfile([disk("old", 100)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map([["old", 100]]), 150);
    await w.tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();
    expect(w.has("s1")).toBe(true);
  });

  it("删除:文件从列表消失(空列表)→ 不绑", async () => {
    const d = makeDeps({ profile: listProfile([]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map([["old", 100]]), 150);
    await w.tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();
    expect(w.has("s1")).toBe(true);
  });

  it("改名:旧文件消失 + 新 id 文件出现 → 按新文件绑新 id", async () => {
    const d = makeDeps({ profile: listProfile([disk("renamed", 200)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map([["old", 100]]), 150);
    await w.tryBind("s1");
    expect(d.onBound).toHaveBeenCalledWith("s1", "renamed");
  });
});

describe("并行 spawn 仲裁", () => {
  it("新文件落盘时刻属于兄弟 spawn(更晚 spawn 且 ≤ mtime)→ 让位不绑", async () => {
    const d = makeDeps({ profile: listProfile([disk("whose", 300)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    // s2 比 s1 晚 spawn,文件的 modifiedAt 在 s2 之后 → 归属 s2
    w.track("s1", "omp", CWD, new Map(), 100);
    w.track("s2", "omp", CWD, new Map(), 200);
    await w.tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();
    expect(w.has("s1")).toBe(true);
  });

  it("新文件归属我(spawn 后落盘且早于兄弟)→ 立即绑", async () => {
    const d = makeDeps({ profile: listProfile([disk("mine", 150)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map(), 100);
    w.track("s2", "omp", CWD, new Map(), 200);
    await w.tryBind("s1");
    expect(d.onBound).toHaveBeenCalledWith("s1", "mine");
  });

  it("无基线归属不可判:同 cwd 老会话在 10s 窗口内 → 让位;窗口外 → 放行", async () => {
    const now = Date.now();
    const live = [disk("x", now)]; // 无基线:fresh 要求 modifiedAt ≥ spawnedAt,须用真实时刻
    // 窗口内:老会话 s2 优先
    const inWin = makeDeps({ profile: listProfile(live) });
    const w1 = reg(new DiskIdentityWatch(inWin.ctx));
    w1.track("s1", "omp", CWD, null, now);
    w1.track("s2", "omp", CWD, null, now - 5_000);
    await w1.tryBind("s1");
    expect(inWin.onBound).not.toHaveBeenCalled();

    // 窗口外:老会话已超 BIND_DEFER_MS,放行绑定
    const outWin = makeDeps({ profile: listProfile(live) });
    const w2 = reg(new DiskIdentityWatch(outWin.ctx));
    w2.track("s1", "omp", CWD, null, now);
    w2.track("s2", "omp", CWD, null, now - 11_000);
    await w2.tryBind("s1");
    expect(outWin.onBound).toHaveBeenCalledWith("s1", "x");
  });
});

describe("排他与绑定终态", () => {
  it("claimed 集内的磁盘身份不绑;绑定瞬间被抢(await 期间)→ 不绑且留 pending", async () => {
    // 静态 claimed
    const d1 = makeDeps({ profile: listProfile([disk("taken", 200)]), claimed: new Set(["taken"]) });
    const w1 = reg(new DiskIdentityWatch(d1.ctx));
    w1.track("s1", "omp", CWD, new Map(), 100);
    await w1.tryBind("s1");
    expect(d1.onBound).not.toHaveBeenCalled();

    // 动态抢绑:listSessions 返回后 claimed 才新增(bind 内同步再校验)
    const d2 = makeDeps({ profile: listProfile([disk("race", 200)]) });
    (d2.profile!.listSessions as Mock).mockImplementation(async () => {
      d2.claimed.add("race");
      return [disk("race", 200)];
    });
    const w2 = reg(new DiskIdentityWatch(d2.ctx));
    w2.track("s1", "omp", CWD, new Map(), 100);
    await w2.tryBind("s1");
    expect(d2.onBound).not.toHaveBeenCalled();
    expect(w2.has("s1")).toBe(true); // 败者留在 pending 继续巡航
  });

  it("remove 清账后探测循环自然终止(不再产生绑定)", async () => {
    const d = makeDeps({ profile: listProfile([disk("late", 200)]) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map(), Date.now());
    expect(w.has("s1")).toBe(true);
    w.remove("s1");
    expect(w.has("s1")).toBe(false);
    await w.tryBind("s1"); // pending 已清:无副作用
    expect(d.onBound).not.toHaveBeenCalled();
  });
});

describe("内容自证主路径(readSessionFileIdentity)", () => {
  const contentProfile = (
    id: string,
    identity: { cwd?: string; createdAt?: number } | null,
  ): CliProfile =>
    ({
      id: "omp",
      name: "omp",
      command: "omp",
      listSessions: vi.fn().mockResolvedValue([disk(id, 200)]),
      /* 守卫:自证 id 必须与候选列表 id 一致,否则视为不可读 */
      readSessionFileIdentity: vi.fn().mockResolvedValue(identity && { ...identity, id }),
    }) as unknown as CliProfile;

  it("cwd 匹配 + createdAt 归属我 → 绑定自证 id", async () => {
    const d = makeDeps({ profile: contentProfile("self", { cwd: CWD, createdAt: 150 }) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map(), 150);
    await w.tryBind("s1");
    expect(d.onBound).toHaveBeenCalledWith("s1", "self");
  });

  it("自证 cwd 不符 → 强拒绝(unmatched),不退回水位线仲裁", async () => {
    const d = makeDeps({ profile: contentProfile("other-cwd", { cwd: "/elsewhere" }) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    w.track("s1", "omp", CWD, new Map(), 150);
    await w.tryBind("s1");
    expect(d.onBound).not.toHaveBeenCalled();
    expect(w.has("s1")).toBe(true);
  });

  it("读不出身份(null)→ 退回水位线兜底仲裁", async () => {
    const d = makeDeps({ profile: contentProfile("f1", null) });
    const w = reg(new DiskIdentityWatch(d.ctx));
    // f1 在基线外、归属我 → 兜底路径按 modifiedAt 绑文件 id
    w.track("s1", "omp", CWD, new Map(), 150);
    await w.tryBind("s1");
    expect(d.onBound).toHaveBeenCalledWith("s1", "f1");
  });
});
