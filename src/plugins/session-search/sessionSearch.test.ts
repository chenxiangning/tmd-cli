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

import {
  SessionIndexer,
  clearIndexCache,
  searchSessions,
  timeRangeFor,
  applyFilters,
  locateTargetOf,
  type SessionIndex,
  type SessionIndexEntry,
} from "./indexer";

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

  it("多关键词空格分词全命中(AND):缺一不可", async () => {
    const indexer = new SessionIndexer("/ws");
    await indexer.prime();
    await indexer.step();
    await indexer.step();
    expect(searchSessions(indexer.index, "修 checkpoints")).toHaveLength(1); // 同一条消息双词
    expect(searchSessions(indexer.index, "修 爬虫")).toHaveLength(0); // 两词分属两条会话,单条不含全词
  });

  it("命中片段带 matchToken(高亮拆分锚);标题命中回落首词", async () => {
    const indexer = new SessionIndexer("/ws");
    await indexer.prime();
    await indexer.step();
    await indexer.step();
    const [msgHit] = searchSessions(indexer.index, "归因");
    expect(msgHit?.matchToken).toBe("归因");
    expect(msgHit?.snippet).toContain("归因");
    const [titleHit] = searchSessions(indexer.index, "审批线");
    expect(titleHit?.matchToken).toBe("审批线");
  });
});

/* ── 时间谓词(闭区间,等值命中)与 chip 叠加管线 ────────────────── */

function entryOf(profileId: string, id: string, modifiedAt: number, message: string): SessionIndexEntry {
  return { profileId, cliSessionId: id, modifiedAt, messages: [message] };
}

function indexOf(entries: SessionIndexEntry[]): SessionIndex {
  return { cwd: "/ws", entries, scanned: entries.length, total: entries.length, listFailed: 0 };
}

const HITS_FIXTURE = [
  entryOf("omp", "old", 1000, "修 checkpoints 归因"),
  entryOf("omp", "mid", 2000, "写个爬虫抓价格"),
  entryOf("kimi", "new", 3000, "再修 checkpoints"),
];

describe("searchSessions 时间谓词", () => {
  it("fromMs/toMs 闭区间:两端等值命中,界外滤除", () => {
    const hits = searchSessions(indexOf(HITS_FIXTURE), "checkpoints", 50, { fromMs: 1000, toMs: 3000 });
    expect(hits.map((h) => h.entry.cliSessionId).sort()).toEqual(["new", "old"]);
  });

  it("区间收窄滤除界外;缺省端该侧不限;无 range 恒等", () => {
    const index = indexOf(HITS_FIXTURE);
    expect(searchSessions(index, "checkpoints", 50, { fromMs: 1001 }).map((h) => h.entry.cliSessionId)).toEqual(["new"]);
    expect(searchSessions(index, "checkpoints", 50, { toMs: 2999 }).map((h) => h.entry.cliSessionId)).toEqual(["old"]);
    expect(searchSessions(index, "checkpoints", 50, { fromMs: 1000 })).toHaveLength(2); // 缺 toMs = 不限上界
    expect(searchSessions(index, "checkpoints")).toHaveLength(2); // 无 range = 不过滤
  });

  it("时间窗与查询 AND 叠加:窗外有条目不因查询命中而复活", () => {
    const hits = searchSessions(indexOf(HITS_FIXTURE), "爬虫", 50, { fromMs: 5000 });
    expect(hits).toHaveLength(0);
  });
});

describe("时间 chip 枚举与叠加管线", () => {
  it("timeRangeFor 映射回溯窗(仅下界);all = undefined 不限", () => {
    expect(timeRangeFor("24h", 5_000_000)).toEqual({ fromMs: 5_000_000 - 24 * 60 * 60_000 });
    expect(timeRangeFor("7d", 5_000_000)).toEqual({ fromMs: 5_000_000 - 7 * 24 * 60 * 60_000 });
    expect(timeRangeFor("30d", 5_000_000)).toEqual({ fromMs: 5_000_000 - 30 * 24 * 60 * 60_000 });
    expect(timeRangeFor("all", 5_000_000)).toBeUndefined();
  });

  it("applyFilters 引擎子集;选中引擎不在集合视为未选;null 恒等", () => {
    const raw = searchSessions(indexOf(HITS_FIXTURE), "checkpoints");
    expect(applyFilters(raw, "omp").map((h) => h.entry.cliSessionId)).toEqual(["old"]);
    expect(applyFilters(raw, "codex")).toBe(raw); // codex 无命中 = 恒等
    expect(applyFilters(raw, null)).toBe(raw);
  });

  it("时间窗 + 引擎 chip 双层叠加:两层同时收口", () => {
    const raw = searchSessions(indexOf(HITS_FIXTURE), "checkpoints", 50, { fromMs: 1000, toMs: 3000 });
    expect(applyFilters(raw, "omp").map((h) => h.entry.cliSessionId)).toEqual(["old"]);
    expect(applyFilters(raw, "kimi").map((h) => h.entry.cliSessionId)).toEqual(["new"]);
    /* 时间窗已把 omp 全滤出时再选 omp = 不在集合,恒等回落(不误清空)。 */
    const narrowed = searchSessions(indexOf(HITS_FIXTURE), "checkpoints", 50, { fromMs: 1500 });
    expect(applyFilters(narrowed, "omp")).toHaveLength(1);
  });
});

describe("行级定位目标构造", () => {
  it("消息命中构造 openThenJumpToText 入参(target + needle 原文)", () => {
    const [hit] = searchSessions(indexOf(HITS_FIXTURE), "爬虫");
    expect(hit?.message).toBe("写个爬虫抓价格");
    const locate = locateTargetOf(hit!, "/ws2", "ws1");
    expect(locate).toEqual({
      target: { profileId: "omp", cwd: "/ws2", workspaceId: "ws1", cliSessionId: "mid" },
      text: "写个爬虫抓价格",
    });
  });

  it("标题命中无消息正文返回 null = 只开会话不定位;workspaceId 可缺省", () => {
    const entry: SessionIndexEntry = {
      profileId: "omp",
      cliSessionId: "t1",
      title: "标题词",
      modifiedAt: 1000,
      messages: [],
    };
    const [hit] = searchSessions(indexOf([entry]), "标题词");
    expect(hit?.inTitle).toBe(true);
    expect(hit?.message).toBeUndefined();
    expect(locateTargetOf(hit!, "/ws")).toBeNull();
    const [msgHit] = searchSessions(indexOf([entry]), "标题词");
    expect(locateTargetOf({ ...msgHit!, message: "正文" }, "/ws")?.target.workspaceId).toBeUndefined();
  });
});
