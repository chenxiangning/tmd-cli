/**
 * mergeDisk 五态推导回归(生命周期 2026-09-17 定义)。
 * 硬契约:① 查看→归档落定后 VIEWED_FLASH_MS 窗内显示瞬态「结束-已查看」,
 * 期满转「已归档」;② 归档标记跨打开/关闭持久,不随磁盘新鲜回落
 * (已归档→打开→关闭→再归档 往返成立);③ 未标记行按年龄落未查看/已查看。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "@kernel/ipc";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import type { SessionArchiveEntry } from "@kernel/sessionArchive";
import type { Workspace } from "@kernel/workspace";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionSpawn: vi.fn(async () => ({ id: "pty-x", pid: 1 })),
    sessionList: vi.fn(async () => [] as SessionMeta[]),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
    sessionResize: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { mergeDisk, type ScanEntry } from "./boardRows";

const ws = { id: "ws1", name: "p", root: "/proj", createdAt: 0 } as Workspace;
const profile = { id: "claude", name: "Claude" } as CliProfile;

function entry(diskAgeMs: number): ScanEntry {
  return {
    ws,
    profile,
    disk: { id: "d1", path: "/f.jsonl", modifiedAt: Date.now() - diskAgeMs } as CliDiskSession,
  };
}

const KEY = "ws1:claude:d1";

describe("mergeDisk 五态推导", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("未标记:新鲜 → 结束-未查看;超 14 天 → 结束-已查看(超期视同已查看)", () => {
    expect(mergeDisk([entry(3600_000)], {}, {})[0]!.st).toBe("ended-new");
    expect(mergeDisk([entry(15 * 24 * 3600_000)], {}, {})[0]!.st).toBe("ended-seen");
  });

  it("归档落定:瞬态窗内显示 结束-已查看,期满转 已归档", () => {
    const archive: Record<string, SessionArchiveEntry> = {
      [KEY]: { archivedAt: Date.now() - 1_000 },
    };
    expect(mergeDisk([entry(3600_000)], {}, archive)[0]!.st).toBe("ended-seen");
    vi.advanceTimersByTime(2_000); /* 累计 3s,超出 2.4s 瞬态窗 */
    expect(mergeDisk([entry(3600_000)], {}, archive)[0]!.st).toBe("archived");
  });

  it("归档往返持久:老标记 + 刚改动的磁盘行仍为 已归档(不回落未查看)", () => {
    const archive: Record<string, SessionArchiveEntry> = {
      [KEY]: { archivedAt: Date.now() - 86_400_000 },
    };
    expect(mergeDisk([entry(1_000)], {}, archive)[0]!.st).toBe("archived");
  });
});
