/**
 * indexer 契约测试(042 跨工作区批)—— 增量扫描/mtime 缓存(cwd 命名空间
 * 留存 + 全局 LRU(上限常量))/失效区灰数据/进度计数(host/ipc 以 vi.mock 桩注入)。
 * 检索纯函数面在 sessionSearch.test.ts。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const profiles = vi.hoisted(() => ({
  list: [] as Array<CountingProfile | { id: string }>,
}));
const ipcMock = vi.hoisted(() => ({
  fsWalkFiles: vi.fn(),
  fsReadHead: vi.fn(),
}));

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => profiles.list,
    getCliProfile: (id: string) => profiles.list.find((p) => p.id === id),
  },
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import { SessionIndexer, clearIndexCache, INDEX_CACHE_CAP } from "./indexer";

/** 带计数读取器的 profile 桩:reads 记录真读次数(cached 步应零读)。 */
interface CountingProfile {
  id: string;
  name: string;
  listSessions: () => Promise<Array<{ id: string; title?: string; modifiedAt: number; path: string }>>;
  readSessionUserMessages: (cwd: string, id: string) => Promise<Array<{ id: string; text: string }> | null>;
}

/** omp 桩工厂:每用例新建,避免跨用例改桩污染。 */
function makeOmp(): CountingProfile {
  return {
    id: "omp",
    name: "omp",
    listSessions: async () => [
      { id: "a", title: "改审批线", modifiedAt: 200, path: "/tmp/a.jsonl" },
      { id: "b", modifiedAt: 100, path: "/tmp/b.jsonl" },
    ],
    readSessionUserMessages: async (_cwd, id) => [
      { id: "m1", text: id === "a" ? "帮我修 checkpoints 的归因 bug" : "写个爬虫抓价格" },
    ],
  };
}

function makeCounting(base: CountingProfile, onRead: () => void): CountingProfile {
  return {
    ...base,
    readSessionUserMessages: async (_cwd, id) => {
      onRead();
      return [{ id: "m1", text: `内容 ${id}` }];
    },
  };
}

beforeEach(() => {
  profiles.list = [makeOmp(), { id: "shell" }]; // shell 无 listSessions/readSessionUserMessages → 过滤
  clearIndexCache();
  ipcMock.fsWalkFiles.mockResolvedValue([]); // root 复核:默认可达
  ipcMock.fsReadHead.mockResolvedValue(null); // 用量:默认无
});

describe("SessionIndexer", () => {
  it("过滤无读取器的 profile,枚举作业按最近修改排序", async () => {
    const indexer = new SessionIndexer([{ root: "/ws" }]);
    expect(indexer.cwd).toBe("/ws");
    const total = await indexer.prime();
    expect(total).toBe(2);
    await indexer.step();
    expect(indexer.index.entries[0]?.cliSessionId).toBe("a"); // modifiedAt 200 在前
  });

  it("step 推进至 done;消息文本进索引;per-entry cwd/workspaceId 落位", async () => {
    const indexer = new SessionIndexer([{ root: "/ws", id: "w1" }]);
    await indexer.prime();
    const r1 = await indexer.step();
    const r2 = await indexer.step();
    const r3 = await indexer.step();
    expect([r1.more, r2.more, r3.more]).toEqual([true, false, false]);
    expect(indexer.index.entries).toHaveLength(2);
    expect(indexer.index.entries[1]?.messages[0]).toContain("爬虫");
    expect(indexer.index.entries[0]).toMatchObject({ cwd: "/ws", workspaceId: "w1" });
  });

  it("mtime 未变的会话零读取(缓存命中);step 回报 cached 位", async () => {
    const indexer = new SessionIndexer([{ root: "/ws" }]);
    await indexer.prime();
    await indexer.step();
    await indexer.step();
    let reads = 0;
    profiles.list = [
      {
        ...makeOmp(),
        readSessionUserMessages: async (): Promise<null> => {
          reads += 1;
          return null;
        },
      },
      { id: "shell" },
    ];
    const indexer2 = new SessionIndexer([{ root: "/ws" }]);
    await indexer2.prime();
    const r1 = await indexer2.step();
    const r2 = await indexer2.step();
    expect(reads).toBe(0); // 两个会话 mtime 未变
    expect([r1.cached, r2.cached]).toEqual([true, true]);
  });

  it("prime 只剪「本次 cwd 且不在 live 集」的死键;他区缓存留存(切区零重读)", async () => {
    let reads = 0;
    const bump = () => {
      reads += 1;
    };
    const ws2: CountingProfile = {
      id: "kimi",
      name: "kimi",
      listSessions: async () => [{ id: "c", modifiedAt: 150, path: "/tmp/c.jsonl" }],
      readSessionUserMessages: async () => [{ id: "m1", text: "跨区会话" }],
    };
    const ompBase: CountingProfile = {
      id: "omp",
      name: "omp",
      listSessions: makeOmp().listSessions,
      readSessionUserMessages: async () => [{ id: "m1", text: "占位" }],
    };
    // 双区各扫一遍(缓存留存两组键):a/b 属 /ws,c 属 /ws2
    profiles.list = [makeCounting(ompBase, bump), makeCounting(ws2, bump)];
    const i1 = new SessionIndexer([{ root: "/ws" }]);
    await i1.prime();
    while ((await i1.step()).more) { /* 排空 */ }
    const i2 = new SessionIndexer([{ root: "/ws2" }]);
    await i2.prime();
    while ((await i2.step()).more) { /* 排空 */ }
    expect(reads).toBe(3);
    // /ws 的 live 集删掉 b 后重 prime:只剪 /ws 死键;/ws2 的 c 留存
    profiles.list = [
      makeCounting({ ...ompBase, listSessions: async () => [
        { id: "a", title: "改审批线", modifiedAt: 200, path: "/tmp/a.jsonl" },
      ] }, bump),
      makeCounting(ws2, bump),
    ];
    const i3 = new SessionIndexer([{ root: "/ws" }]);
    await i3.prime();
    while ((await i3.step()).more) { /* 排空:a 缓存命中,无新读 */ }
    expect(reads).toBe(3);
    // 切回 /ws2:c 未因 /ws 的 prime 被剪 → 零重读
    const i4 = new SessionIndexer([{ root: "/ws2" }]);
    await i4.prime();
    while ((await i4.step()).more) { /* 排空 */ }
    expect(reads).toBe(3);
  });

  it("全局 LRU 淘汰序:超量按最近使用淘汰,被淘汰者成为下轮唯一重读", async () => {
    /* modifiedAt: -i → 作业按时间倒序 = s0 最先处理;首扫后 s0 最久未用 = 淘汰对象。 */
    let reads = 0;
    const many = (n: number): CountingProfile => ({
      id: "omp",
      name: "omp",
      listSessions: async () =>
        Array.from({ length: n }, (_, i) => ({
          id: `s${i}`,
          modifiedAt: -i,
          path: `/tmp/s${i}.jsonl`,
        })),
      readSessionUserMessages: async (_c, id) => {
        reads += 1;
        return [{ id: "m1", text: `正文 ${id}` }];
      },
    });
    profiles.list = [many(INDEX_CACHE_CAP)];
    const i1 = new SessionIndexer([{ root: "/ws" }]);
    await i1.prime();
    while ((await i1.step()).more) { /* 填满至上限:reads = CAP */ }
    expect(reads).toBe(INDEX_CACHE_CAP);
    // live 集追加一个全新会话(排最后):set 后 3001 > 3000 → 淘汰最久未用 s0
    profiles.list = [many(INDEX_CACHE_CAP + 1)];
    const i2 = new SessionIndexer([{ root: "/ws" }]);
    await i2.prime();
    while ((await i2.step()).more) { /* 排空:仅新会话真读,其余缓存命中 */ }
    expect(reads).toBe(INDEX_CACHE_CAP + 1);
    // 同集再扫:被逐者 s0 首个入作业且唯一失缓存 → 首步即重读
    /* (s0 重入缓存会再挤掉 s1——工作集 3001 > 上限 3000 的固有抖动,不做全量断言) */
    const i3 = new SessionIndexer([{ root: "/ws" }]);
    await i3.prime();
    await i3.step(); // s0
    expect(i3.index.entries[0]?.cliSessionId).toBe("s0");
    expect(reads).toBe(INDEX_CACHE_CAP + 2); // 只补读了 s0(LRU 淘汰序正确)
  });

  it("失效区灰数据:root 复核失败的区进 goneCwds、不枚举会话;进度仍计 1 区", async () => {
    ipcMock.fsWalkFiles.mockImplementation(async (root: string) => {
      if (root === "/gone") throw new Error("目录不存在");
      return [];
    });
    const ws2: CountingProfile = {
      id: "kimi",
      name: "kimi",
      listSessions: async () => [{ id: "c", modifiedAt: 150, path: "/tmp/c.jsonl" }],
      readSessionUserMessages: async () => [{ id: "m1", text: "跨区会话" }],
    };
    profiles.list = [makeOmp(), ws2];
    const indexer = new SessionIndexer([
      { root: "/ws", id: "w1" },
      { root: "/gone", id: "w2" },
    ]);
    const total = await indexer.prime();
    expect(indexer.index.goneCwds).toEqual(["/gone"]);
    expect(indexer.index.workspacesTotal).toBe(2);
    expect(indexer.index.scannedWorkspaces).toBe(2); // 失效区也计数(进度不悬空)
    expect(total).toBe(3); // /ws 下两个 profile 各列作业(omp×2 + kimi×1),/gone 不枚举
    while ((await indexer.step()).more) { /* 排空 */ }
    expect(indexer.index.entries.every((e) => e.cwd === "/ws" && e.workspaceId === "w1")).toBe(true);
  });
});
