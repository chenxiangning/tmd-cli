/**
 * 增强持久化层契约:加载/损坏重置、lastUsed 记忆、缓存 LRU(命中挪尾/容量逐出/
 * 键含档位模型)、历史去重置顶与容量、写盘串行。持久化经 __usePersist 注桩。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let disk: string | null = null;
const writes: string[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: { configDir: async () => "/cfg", fsReadFile: async () => disk, fsWriteFile: async (_p: string, t: string) => { writes.push(t); } },
}));

import {
  CACHE_MAX,
  HISTORY_MAX,
  __reset,
  __usePersist,
  ensureLoaded,
  getLastUsed,
  getHistory,
  pushHistory,
  readCache,
  setLastUsed,
  writeCache,
} from "./enhanceStore";

beforeEach(async () => {
  disk = null;
  writes.length = 0;
  __reset();
  __usePersist();
  await ensureLoaded();
});

const entry = (n: number) => ({ original: `o${n}`, enhanced: `e${n}`, engineId: "omp", preset: "light" as const, model: "", at: n });

describe("ensureLoaded", () => {
  it("无文件 = 空态;损坏 JSON 静默重置", async () => {
    expect(readCache("omp", "light", "", "d")).toBeNull();
    expect(getHistory()).toEqual([]);

    disk = "{broken json";
    __reset();
    await ensureLoaded();
    expect(getHistory()).toEqual([]);
    expect(readCache("omp", "light", "", "d")).toBeNull();
  });

  it("盘上形态恢复:lastUsed/cache/history", async () => {
    disk = JSON.stringify({
      lastUsed: { engineId: "kimi", preset: "structured", model: "k3", timeoutSeconds: 90 },
      cache: { "omp\u0001light\u0001\u0001草稿": { text: "旧结果", at: 1 } },
      history: [entry(1)],
    });
    __reset();
    await ensureLoaded();
    expect(getLastUsed()).toEqual({ engineId: "kimi", preset: "structured", model: "k3", timeoutSeconds: 90 });
    expect(readCache("omp", "light", "", "草稿")).toBe("旧结果");
    expect(getHistory()).toHaveLength(1);
  });

  it("history 超长截到上限;cache 非对象重置", async () => {
    disk = JSON.stringify({
      history: Array.from({ length: HISTORY_MAX + 5 }, (_, i) => entry(i)),
      cache: ["not-an-object"],
    });
    __reset();
    await ensureLoaded();
    expect(getHistory()).toHaveLength(HISTORY_MAX);
    expect(readCache("omp", "light", "", "d")).toBeNull();
  });
});

describe("lastUsed", () => {
  it("setLastUsed 落盘(写盘被调用)", async () => {
    await Promise.resolve();
    writes.length = 0;
    setLastUsed({ engineId: "omp", preset: "light", model: "", timeoutSeconds: 60 });
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(JSON.parse(writes[0]).lastUsed).toEqual({ engineId: "omp", preset: "light", model: "", timeoutSeconds: 60 });
  });
});

describe("cache LRU", () => {
  it("命中回填并挪尾;键含引擎/档位/模型/草稿四段", async () => {
    writeCache("omp", "light", "", "草稿", "结果1");
    expect(readCache("omp", "light", "", "草稿")).toBe("结果1");
    expect(readCache("omp", "structured", "", "草稿")).toBeNull();
    expect(readCache("kimi", "light", "", "草稿")).toBeNull();
    expect(readCache("omp", "light", "k3", "草稿")).toBeNull();
  });

  it("容量 " + CACHE_MAX + " 满额逐出最久未用,touch 后的幸存", async () => {
    for (let i = 0; i < CACHE_MAX; i++) writeCache("omp", "light", "", `d${i}`, `r${i}`);
    readCache("omp", "light", "", "d0"); /* touch d0 → 最旧变 d1 */
    writeCache("omp", "light", "", "new", "rn");
    expect(readCache("omp", "light", "", "d1")).toBeNull();
    expect(readCache("omp", "light", "", "d0")).toBe("r0");
    expect(readCache("omp", "light", "", "new")).toBe("rn");
  });
});

describe("history", () => {
  it("新条目置顶;同 原文+终稿+引擎+档位 去重刷新置顶", () => {
    pushHistory(entry(1));
    pushHistory(entry(2));
    expect(getHistory().map((h) => h.original)).toEqual(["o2", "o1"]);
    pushHistory({ ...entry(1), at: 99 });
    expect(getHistory()).toHaveLength(2);
    expect(getHistory()[0].at).toBe(99);
  });

  it(`容量 ${HISTORY_MAX} 截断`, () => {
    for (let i = 0; i < HISTORY_MAX + 3; i++) pushHistory(entry(i));
    expect(getHistory()).toHaveLength(HISTORY_MAX);
    expect(getHistory()[0].original).toBe(`o${HISTORY_MAX + 2}`);
  });
});
