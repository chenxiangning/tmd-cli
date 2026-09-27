/**
 * session-search 纯逻辑契约测试:indexer 的增量/mtime 缓存与 searchSessions 检索。
 * host 以 vi.mock 桩注入(两条 profile:omp 全功能 / shell 无读取器被过滤)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const profiles = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
}));

vi.mock("@kernel/host", () => ({
  host: {
    getCliProfiles: () => profiles.list,
    getCliProfile: (id: string) => profiles.list.find((p) => p.id === id),
  },
}));

import { SessionIndexer, clearIndexCache, searchSessions } from "./indexer";

/** omp 桩工厂:每用例新建,避免跨用例改桩污染。 */
function makeOmp() {
  return {
    id: "omp",
    name: "omp",
    listSessions: async () => [
      { id: "a", title: "改审批线", modifiedAt: 200, path: "/tmp/a.jsonl" },
      { id: "b", modifiedAt: 100, path: "/tmp/b.jsonl" },
    ],
    readSessionUserMessages: async (_cwd: string, id: string) => [
      { id: "m1", text: id === "a" ? "帮我修 checkpoints 的归因 bug" : "写个爬虫抓价格" },
    ],
  };
}

beforeEach(() => {
  profiles.list = [makeOmp(), { id: "shell" }]; // shell 无 listSessions/readSessionUserMessages → 过滤
  clearIndexCache();
});

describe("SessionIndexer", () => {
  it("过滤无读取器的 profile,枚举作业按最近修改排序", async () => {
    const indexer = new SessionIndexer("/ws");
    const total = await indexer.prime();
    expect(total).toBe(2);
    await indexer.step();
    expect(indexer.index.entries[0]?.cliSessionId).toBe("a"); // modifiedAt 200 在前
  });

  it("step 推进至 done;消息文本进索引", async () => {
    const indexer = new SessionIndexer("/ws");
    await indexer.prime();
    const more1 = await indexer.step();
    const more2 = await indexer.step();
    const more3 = await indexer.step();
    expect([more1, more2, more3]).toEqual([true, false, false]);
    expect(indexer.index.entries).toHaveLength(2);
    expect(indexer.index.entries[1]?.messages[0]).toContain("爬虫");
  });

  it("mtime 未变的会话零读取(缓存命中)", async () => {
    const indexer = new SessionIndexer("/ws");
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
    const indexer2 = new SessionIndexer("/ws");
    await indexer2.prime();
    await indexer2.step();
    await indexer2.step();
    expect(reads).toBe(0); // 两个会话 mtime 未变
  });
});

describe("searchSessions", () => {
  it("标题命中优先于消息命中", async () => {
    const indexer = new SessionIndexer("/ws");
    await indexer.prime();
    await indexer.step();
    await indexer.step();
    const hits = searchSessions(indexer.index, "审批线");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.inTitle).toBe(true);
    expect(hits[0]?.snippet).toContain("审批线");
  });

  it("消息正文命中;大小写不敏感;空查询返回空", async () => {
    const indexer = new SessionIndexer("/ws");
    await indexer.prime();
    await indexer.step();
    await indexer.step();
    expect(searchSessions(indexer.index, "爬虫")).toHaveLength(1);
    expect(searchSessions(indexer.index, "CHECKPOINTS")).toHaveLength(1);
    expect(searchSessions(indexer.index, "  ")).toEqual([]);
  });
});
