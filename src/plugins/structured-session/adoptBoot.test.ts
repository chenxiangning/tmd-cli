import { describe, expect, it, vi } from "vitest";

/* 桩面:ipc 枚举/杀/开 tab 全 mock;host/workspace 不进链(adoptBoot 只消费 ipc + kernel 契约)。 */
const h = vi.hoisted(() => ({
  list: [] as Array<{ id: string; label: string | null }>,
  killed: [] as string[],
  opened: [] as Array<{ profileId: string; cwd?: string; adoptStreamId?: string }>,
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
          return sep <= 0 ? null : { profileId: rest.slice(0, sep), cwd: rest.slice(sep + 1) };
        })()
      : null,
  openStructuredSessionTab: (profileId: string, cwd?: string, opts?: { adoptStreamId?: string }) => {
    h.opened.push({ profileId, cwd, adoptStreamId: opts?.adoptStreamId });
  },
}));

import { adoptOrphanStreams } from "./adoptBoot";

describe("boot 收养(批次 3:枚举 → structured label 反解开 tab,其余 kill)", () => {
  it("structured: label 反解 profileId/cwd(含冒号 cwd 不裂),开 adopt tab", async () => {
    h.list = [{ id: "proc-1", label: "structured:omp:/repo/a:b" }];
    adoptOrphanStreams();
    await vi.waitFor(() => expect(h.opened).toHaveLength(1));
    expect(h.opened[0]).toEqual({ profileId: "omp", cwd: "/repo/a:b", adoptStreamId: "proc-1" });
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
