import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiRpcSession } from "../cli-shared/piRpc";

/* 桩面:ipc 枚举/杀/开 tab 全 mock;host/workspace 不进链(adoptBoot 只消费 ipc + kernel 契约)。 */
const h = vi.hoisted(() => ({
  list: [] as Array<{ id: string; label: string | null }>,
  killed: [] as string[],
  opened: [] as Array<{ profileId: string; cwd?: string; adoptStreamId?: string; resumeSessionId?: string }>,
  profile: null as {
    listSessions: (cwd: string) => Promise<Array<{ id: string; path: string; modifiedAt: number }>>;
    readSessionTranscript: (s: { id: string }) => Promise<{ blocks: Array<{ id: string; role: "user"; text: string }> }>;
  } | null,
}));

vi.mock("@kernel/host", () => ({
  host: { getCliProfile: () => h.profile },
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    procStreamList: () => Promise.resolve(h.list),
    procStreamKill: (id: string) => {
      h.killed.push(id);
      return Promise.resolve();
    },
  },
}));
vi.mock("@kernel/structuredSessionTabs", () => ({
  structuredSessionTarget: (label: string | undefined) =>
    label?.startsWith("structured:")
      ? (() => {
          const rest = label.slice("structured:".length);
          const sep = rest.indexOf(":");
          if (sep <= 0) return null;
          const tail = rest.slice(sep + 1);
          const hash = tail.lastIndexOf("#");
          return { profileId: rest.slice(0, sep), cwd: hash > 0 ? tail.slice(0, hash) : tail };
        })()
      : null,
  openStructuredSessionTab: (profileId: string, cwd?: string, opts?: { adoptStreamId?: string; resumeSessionId?: string }) => {
    h.opened.push({ profileId, cwd, adoptStreamId: opts?.adoptStreamId, resumeSessionId: opts?.resumeSessionId });
  },
}));

import { adoptDiskSeed, adoptOrphanStreams, cancelAdoptKill, scheduleAdoptKill } from "./adoptBoot";

describe("boot 收养(批次 3:枚举 → structured label 反解开 tab,其余 kill)", () => {
  it("structured: label 反解 profileId/cwd(含冒号 cwd 不裂),开 adopt tab", async () => {
    h.list = [{ id: "proc-1", label: "structured:omp:/repo/a:b" }];
    adoptOrphanStreams();
    await vi.waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toEqual({ profileId: "omp", cwd: "/repo/a:b", adoptStreamId: "proc-1", resumeSessionId: undefined });
    expect(h.killed).toEqual([]);
  });

  it("resume 判别后缀(# 段)带回 tab id:多 RPC 会话并行 reload 后各回各 tab", async () => {
    h.opened = [];
    h.list = [
      { id: "proc-1", label: "structured:omp:/repo#cli-1" },
      { id: "proc-2", label: "structured:omp:/repo#cli-2" },
    ];
    adoptOrphanStreams();
    await vi.waitFor(() => expect(h.opened).toHaveLength(2));
    expect(h.opened[0]).toMatchObject({ cwd: "/repo", adoptStreamId: "proc-1", resumeSessionId: "cli-1" });
    expect(h.opened[1]).toMatchObject({ cwd: "/repo", adoptStreamId: "proc-2", resumeSessionId: "cli-2" });
    expect(h.killed).toEqual([]);
  });

  it("无 label / 非 structured label = 无人认领,kill 兜底(等价旧 boot kill_all 语义)", async () => {
    h.opened = [];
    h.list = [
      { id: "proc-2", label: null },
      { id: "proc-3", label: "some-other-consumer" },
    ];
    adoptOrphanStreams();
    await vi.waitFor(() => expect(h.killed).toEqual(["proc-2", "proc-3"]));
    expect(h.opened).toEqual([]);
  });

  it("空枚举零动作;listSessions 读转录链不在本模块(adoptDiskSeed 独立)", async () => {
    h.killed = [];
    h.list = [];
    adoptOrphanStreams();
    /* 微任务冲刷 .then 链(无真定时器):空表分支不应触碰 kill/open。 */
    await Promise.resolve();
    await Promise.resolve();
    expect(h.killed).toEqual([]);
    expect(h.opened).toEqual([]);
  });
});

describe("收养流延迟 kill(评审 P2:StrictMode 双挂载接管保护)", () => {
  it("无接管 → 定时器到点 kill 落地(真关 tab 语义不变)", () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    scheduleAdoptKill("proc-9", kill);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(kill).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("定时器到点前第二遍挂载接管 → cancelAdoptKill 挡杀", () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    scheduleAdoptKill("proc-9", kill);
    cancelAdoptKill("proc-9");
    vi.advanceTimersByTime(0);
    expect(kill).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("adoptDiskSeed keepTail 分流(2026-11-05 关闭重开丢历史修复)", () => {
  /** resume/收养两种 payload 下,adoptSeed 收到的 keepTail 旗标;
   *  session/profile 为最小桩(仅 adoptSeed 旗标捕获 + 转录读链直通)。 */
  function seedFlagFor(payload: { adoptStreamId?: string; resumeSessionId?: string; resumeUnsettled?: boolean }) {
    const seeded: boolean[] = [];
    /* 具名转换:PiRpcSession 全编排不需要,只截 adoptSeed 一个面。 */
    const session = { adoptSeed: (_blocks: unknown[], keepTail: boolean) => seeded.push(keepTail) } as unknown as PiRpcSession;
    adoptDiskSeed(session, { profileId: "omp", cwd: "/repo", ...payload }, "cli-9");
    /* 转录链三跳 promise:以「旗标落位」为信号等待,不猜时长。 */
    return vi.waitFor(() => {
      expect(seeded).toHaveLength(1);
      return seeded;
    });
  }

  beforeEach(() => {
    h.profile = {
      listSessions: () => Promise.resolve([{ id: "cli-9", path: "/p", modifiedAt: 1 }]),
      readSessionTranscript: () => Promise.resolve({ blocks: [{ id: "b", role: "user" as const, text: "问" }] }),
    };
  });

  it("resume(关闭会话重开)= keepTail true:磁盘历史全量保留,末轮不剪(引擎 resume 零重放)", async () => {
    expect(await seedFlagFor({ resumeSessionId: "cli-9" })).toEqual([true]);
  });

  it("活流收养(adoptStreamId)= keepTail false:在途轮不带走防重放重复(原语义不变)", async () => {
    expect(await seedFlagFor({ adoptStreamId: "proc-7" })).toEqual([false]);
  });

  it("resumeUnsettled(busy 中关闭)= keepTail false:引擎将重放在途轮,种子剪尾防整轮重复", async () => {
    expect(await seedFlagFor({ resumeSessionId: "cli-9", resumeUnsettled: true })).toEqual([false]);
  });
});
