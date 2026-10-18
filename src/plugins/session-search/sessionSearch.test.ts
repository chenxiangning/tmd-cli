/**
 * searchCore 纯逻辑契约测试:子串检索(标题优先/AND/大小写/matchToken)、
 * 时间谓词(闭区间)、引擎过滤叠加、行级定位目标构造(042:cwd/workspaceId
 * 取自带,跨区先切后跳)。fixture 直造,零 IO 零 mock。
 */
import { describe, expect, it } from "vitest";
import type { SessionIndex, SessionIndexEntry } from "./indexer";
import {
  searchSessions,
  timeRangeFor,
  applyFilters,
  locateTargetOf,
} from "./searchCore";

function entryOf(
  profileId: string,
  id: string,
  modifiedAt: number,
  message: string,
  extra?: { title?: string; cwd?: string; workspaceId?: string },
): SessionIndexEntry {
  return {
    profileId,
    cliSessionId: id,
    modifiedAt,
    cwd: extra?.cwd ?? "/ws",
    workspaceId: extra?.workspaceId ?? "w1",
    title: extra?.title,
    messages: [message],
  };
}

function indexOf(entries: SessionIndexEntry[]): SessionIndex {
  return {
    cwd: "/ws",
    entries,
    scanned: entries.length,
    total: entries.length,
    listFailed: 0,
    workspacesTotal: 1,
    scannedWorkspaces: 1,
    goneCwds: [],
  };
}

const HITS_FIXTURE = [
  entryOf("omp", "old", 1000, "修 checkpoints 归因"),
  entryOf("omp", "mid", 2000, "写个爬虫抓价格"),
  entryOf("kimi", "new", 3000, "再看 checkpoints 口径"),
];

describe("searchSessions", () => {
  it("标题命中优先于消息命中", () => {
    const index = indexOf([
      entryOf("omp", "t1", 500, "帮我修 checkpoints 的归因 bug", { title: "改审批线" }),
      ...HITS_FIXTURE,
    ]);
    const hits = searchSessions(index, "审批线");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.inTitle).toBe(true);
    expect(hits[0]?.snippet).toContain("审批线");
  });

  it("消息正文命中;大小写不敏感;空查询返回空", () => {
    const index = indexOf(HITS_FIXTURE);
    expect(searchSessions(index, "爬虫")).toHaveLength(1);
    expect(searchSessions(index, "CHECKPOINTS")).toHaveLength(2); // old/new 均含
    expect(searchSessions(index, "  ")).toEqual([]);
  });

  it("多关键词空格分词全命中(AND):缺一不可", () => {
    const index = indexOf(HITS_FIXTURE);
    expect(searchSessions(index, "修 checkpoints")).toHaveLength(1); // 同一条消息双词
    expect(searchSessions(index, "修 爬虫")).toHaveLength(0); // 两词分属两条会话,单条不含全词
  });

  it("命中片段带 matchToken(高亮拆分锚);标题命中回落首词", () => {
    const index = indexOf([
      entryOf("omp", "t1", 500, "帮我修 checkpoints 的归因 bug", { title: "改审批线" }),
    ]);
    const [msgHit] = searchSessions(index, "归因");
    expect(msgHit?.matchToken).toBe("归因");
    expect(msgHit?.snippet).toContain("归因");
    const [titleHit] = searchSessions(index, "审批线");
    expect(titleHit?.matchToken).toBe("审批线");
  });
});

/* ── 时间谓词(闭区间,等值命中)与 chip 叠加管线 ────────────────── */

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

describe("行级定位目标构造(042:cwd/workspaceId 取自带,跨区先切后跳)", () => {
  it("消息命中构造 openThenJumpToText 入参(target + needle 原文)", () => {
    const [hit] = searchSessions(indexOf(HITS_FIXTURE), "爬虫");
    expect(hit?.message).toBe("写个爬虫抓价格");
    const locate = locateTargetOf(hit!);
    expect(locate).toEqual({
      target: { profileId: "omp", cwd: "/ws", workspaceId: "w1", cliSessionId: "mid" },
      text: "写个爬虫抓价格",
    });
  });

  it("标题命中无消息正文返回 null = 只开会话不定位;workspaceId 可缺省", () => {
    const entry: SessionIndexEntry = {
      profileId: "omp",
      cliSessionId: "t1",
      title: "标题词",
      modifiedAt: 1000,
      cwd: "/ws",
      messages: [],
    };
    const [hit] = searchSessions(indexOf([entry]), "标题词");
    expect(hit?.inTitle).toBe(true);
    expect(hit?.message).toBeUndefined();
    expect(locateTargetOf(hit!)).toBeNull();
    const [msgHit] = searchSessions(indexOf([entry]), "标题词");
    expect(locateTargetOf({ ...msgHit!, message: "正文" })?.target.workspaceId).toBeUndefined();
  });
});

/* ── 多命中子列表(042 随手带):同会话全部命中收集 + 跳该处 ────────── */

describe("searchSessions 子命中收集", () => {
  it("同一会话多条命中消息全部入 subHits;首条即 snippet/matchToken 来源", () => {
    const entry = entryOf("omp", "multi", 1000, "第一处 归因", { title: "x" });
    entry.messages.push("第二处 归因", "无关消息");
    const [hit] = searchSessions(indexOf([entry]), "归因");
    expect(hit?.subHits.map((s) => s.message)).toEqual(["第一处 归因", "第二处 归因"]);
    expect(hit?.snippet).toBe(hit?.subHits[0]?.snippet);
    expect(hit?.matchToken).toBe("归因");
    expect(hit?.message).toBe("第一处 归因");
  });

  it("标题 + 消息双命中:subHits 只收消息命中;纯标题命中 subHits 为空", () => {
    const both = entryOf("omp", "b", 1000, "正文 归因", { title: "标题 归因" });
    const [hitBoth] = searchSessions(indexOf([both]), "归因");
    expect(hitBoth?.inTitle).toBe(true);
    expect(hitBoth?.subHits).toHaveLength(1);
    const titleOnly = entryOf("omp", "t", 1000, "无关", { title: "标题 归因" });
    const [hitTitle] = searchSessions(indexOf([titleOnly]), "归因");
    expect(hitTitle?.subHits).toEqual([]);
    expect(hitTitle?.message).toBeUndefined();
  });

  it("subHits 截顶 SUB_HIT_CAP;首条不受截顶影响", () => {
    const entry = entryOf("omp", "cap", 1000, "命中 归因");
    for (let i = 0; i < 30; i++) entry.messages.push(`补 ${i} 归因`);
    const [hit] = searchSessions(indexOf([entry]), "归因");
    expect(hit?.subHits).toHaveLength(20);
    expect(hit?.subHits[0]?.message).toBe("命中 归因");
  });

  it("locateTargetOf 带子命中跳该处;缺省回落首命中", () => {
    const entry = entryOf("omp", "jump", 1000, "第一处 归因");
    entry.messages.push("第二处 归因");
    const [hit] = searchSessions(indexOf([entry]), "归因");
    const sub = hit?.subHits[1];
    expect(locateTargetOf(hit!, sub)?.text).toBe("第二处 归因");
    expect(locateTargetOf(hit!)?.text).toBe("第一处 归因");
    expect(locateTargetOf(hit!, sub)?.target.cliSessionId).toBe("jump");
  });
});
