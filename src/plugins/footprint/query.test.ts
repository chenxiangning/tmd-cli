/** footprint 读侧单测:日明细排序 / 月热力 / 区间聚合 / 搜索四来源分组 / 功能卡校验。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configDir: vi.fn(async () => "/cfg"),
    fsReadFile: vi.fn(async () => {
      throw new Error("missing");
    }),
    fsWriteFile: vi.fn(async () => undefined),
  },
}));
vi.mock("@kernel/fsDirs", () => ({ ensureParentDir: vi.fn(async () => undefined) }));

import { ipc } from "@kernel/ipc";
import { resetMonthCache } from "./rollup";
import { dayDetail, monthHeat, range, searchFootprint, validateFeatureCards, monthSpan, readFeatureCards } from "./query";

const mockIpc = vi.mocked(ipc, true);

const YM = "2026-03";
const D14 = `${YM}-14`;

/** 磁盘桩:月 rollup + 功能卡 + journal 文本 按路径分发。 */
const disk = new Map<string, string>();

const seedMonth = (ym: string, days: Record<string, unknown>): void =>
  void disk.set(`/cfg/footprint/${ym}.json`, JSON.stringify({ version: 1, days }));

beforeEach(() => {
  vi.clearAllMocks();
  resetMonthCache();
  disk.clear();
  mockIpc.fsReadFile.mockImplementation(async (path: string) => {
    const hit = disk.get(path);
    if (hit === undefined) throw new Error(`missing:${path}`);
    return hit;
  });
});

describe("monthSpan / shiftMonth", () => {
  it("同月单元素,跨年进退位", () => {
    expect(monthSpan("2026-03", "2026-03")).toEqual(["2026-03"]);
    expect(monthSpan("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthSpan("2026-01", "2025-11")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("dayDetail / monthHeat", () => {
  beforeEach(() => {
    seedMonth(YM, {
      "14": {
        sessions: { s1: { engine: "omp", cwd: "/ws", turns: [1], first: "", last: "" } },
        files: {
          "src/b.ts": { add: 5, del: 1, cfg: false, refs: ["s1"] },
          "src/a.ts": { add: 1, del: 0, cfg: false, refs: ["s1", "s2"] },
          "cfg/app.json": { add: 2, del: 3, cfg: true, refs: ["s1"] },
        },
        batches: { s1: "b1" },
      },
    });
  });

  it("files 按 refs 数降序,平手按路径", async () => {
    const d = await dayDetail(YM, "14");
    expect(d.files.map((f) => f.path)).toEqual(["src/a.ts", "cfg/app.json", "src/b.ts"]);
    expect(d.batches).toEqual({ s1: "b1" });
  });

  it("缺日返回空明细", async () => {
    const d = await dayDetail(YM, "99");
    expect(d.files).toEqual([]);
    expect(d.sessions).toEqual({});
  });

  it("热力:净增/会话数", async () => {
    const heat = await monthHeat(YM);
    expect(heat).toEqual([{ dd: "14", net: 4, add: 8, del: 4, sessionCount: 1 }]);
  });
});

describe("range", () => {
  beforeEach(() => {
    seedMonth(YM, {
      "13": { sessions: { s1: { engine: "omp", cwd: "/w1", turns: [1], first: "", last: "" } },
        files: { "a.ts": { add: 10, del: 2, cfg: false, refs: ["s1"] } }, batches: {} },
      "15": { sessions: { s2: { engine: "kimi", cwd: "/w2", turns: [1], first: "", last: "" } },
        files: { "b.ts": { add: 1, del: 1, cfg: false, refs: ["s2"] } }, batches: {} },
      "20": { sessions: {}, files: { "c.ts": { add: 99, del: 0, cfg: false, refs: ["sx"] } }, batches: {} },
    });
  });

  it("区间含端点,界外不计;cwd 归因按文件首引用会话", async () => {
    const r = await range(YM, "13", YM, "15");
    expect(r.add).toBe(11);
    expect(r.del).toBe(3);
    expect([...r.files].sort()).toEqual(["a.ts", "b.ts"]);
    expect(r.cwdBreakdown).toEqual({ "/w1": { add: 10, del: 2 }, "/w2": { add: 1, del: 1 } });
  });
});

describe("searchFootprint(四来源分组)", () => {
  const now = new Date(2026, 2, 20); /* 当月 2026-03 → 扫 02/03/04 */

  beforeEach(() => {
    seedMonth(YM, {
      "14": { sessions: {}, files: { "src/Login/登录.ts": { add: 3, del: 0, cfg: false, refs: ["s1"] } }, batches: {} },
    });
    disk.set("/cfg/footprint/features/2026-03-14.json", JSON.stringify({
      version: 1,
      cards: [
        { title: "账号密码登录", summary: "实现了登录表单", sessions: ["s1"] },
        { title: "别的功能", summary: "无关", sessions: ["s1"], quote: { sid: "s1", text: "把登录做成深色", time: "10:00" } },
      ],
    }));
    disk.set("/cfg/daily/digest/2026-03-14.md", "用户说:支持 oauth 登录\n其他行");
    disk.set("/cfg/daily/article/2026-03-14.md", "# 日报\n完成了登录页样式");
  });

  it("path/card/quote/article 各来源命中并按日分组", async () => {
    const hits = await searchFootprint("登录", now);
    const day = hits[D14];
    expect(day).toBeDefined();
    const kinds = day.map((h) => h.kind).sort();
    expect(kinds).toEqual(["article", "card", "path", "quote", "quote"]);
    const card = day.find((h) => h.kind === "card");
    expect(card).toMatchObject({ featureId: 0, snippet: "实现了登录表单" });
    const quotes = day.filter((h) => h.kind === "quote");
    expect(quotes.map((h) => h.featureId)).toContain(1); /* 卡内原话 */
    expect(quotes.some((h) => h.featureId === undefined)).toBe(true); /* digest 摘录 */
  });

  it("大小写不敏感;无命中返回空对象;空 query 不读盘", async () => {
    expect(Object.keys(await searchFootprint("LOGIN", now))).toEqual([D14]);
    expect(await searchFootprint("不存在关键词xyz", now)).toEqual({});
    const before = mockIpc.fsReadFile.mock.calls.length;
    expect(await searchFootprint("", now)).toEqual({});
    expect(mockIpc.fsReadFile.mock.calls.length).toBe(before);
  });

  it("journal/功能卡文件缺失跳过不炸", async () => {
    disk.delete("/cfg/daily/digest/2026-03-14.md");
    disk.delete("/cfg/daily/article/2026-03-14.md");
    disk.delete("/cfg/footprint/features/2026-03-14.json");
    const hits = await searchFootprint("登录", now);
    expect(hits[D14].map((h) => h.kind)).toEqual(["path"]);
  });
});

describe("readFeatureCards(AI + 修正层 v2 差量合并)", () => {
  const AI = "/cfg/footprint/features/2026-03-14.json";
  const USER = "/cfg/footprint/features/2026-03-14.user.json";
  const aiCards = [
    { title: "账号密码登录", summary: "实现了登录表单", sessions: ["s1"] },
    { title: "配置中心", summary: "接入配置页", sessions: ["s2"] },
  ];

  it("仅 AI 档:全卡 provenance=ai,origin=ai", async () => {
    disk.set(AI, JSON.stringify({ version: 1, cards: aiCards }));
    const r = await readFeatureCards(D14);
    expect(r?.origin).toBe("ai");
    expect(r?.file.cards.map((c) => c.title)).toEqual(["账号密码登录", "配置中心"]);
    expect(r?.merged.map((m) => m.provenance)).toEqual(["ai", "ai"]);
  });

  it("回归:早期 v1 手动卡不再吞掉后到的 AI 卡(标题不匹配→added,AI 全集可见)", async () => {
    disk.set(AI, JSON.stringify({ version: 1, cards: aiCards }));
    disk.set(USER, JSON.stringify({ version: 1, cards: [{ title: "项目分析2", summary: "项目分析", sessions: [] }] }));
    const r = await readFeatureCards(D14);
    expect(r?.origin).toBe("user-edited");
    expect(r?.file.cards.map((c) => c.title)).toEqual(["账号密码登录", "配置中心", "项目分析2"]);
    expect(r?.merged.map((m) => m.provenance)).toEqual(["ai", "ai", "added"]);
  });

  it("v2 层:hidden tombstone 剔除 AI 卡,override 原位替换,added 追加", async () => {
    disk.set(AI, JSON.stringify({ version: 1, cards: aiCards }));
    disk.set(USER, JSON.stringify({
      version: 2,
      overrides: { 配置中心: { title: "配置中心", summary: "用户改写", sessions: ["s2", "s3"] } },
      hidden: ["账号密码登录"],
      added: [{ title: "手动卡", summary: "", sessions: [] }],
    }));
    const r = await readFeatureCards(D14);
    expect(r?.file.cards.map((c) => c.title)).toEqual(["配置中心", "手动卡"]);
    expect(r?.file.cards[0].summary).toBe("用户改写");
    expect(r?.merged.map((m) => m.provenance)).toEqual(["override", "added"]);
  });

  it("仅 v1 user 档(无 AI):manual,全部 added(纯手动日语义不变)", async () => {
    disk.set(USER, JSON.stringify({ version: 1, cards: [{ title: "手动卡", summary: "", sessions: [] }] }));
    const r = await readFeatureCards(D14);
    expect(r?.origin).toBe("manual");
    expect(r?.file.cards.map((c) => c.title)).toEqual(["手动卡"]);
  });

  it("两档俱缺 = null;user 档损坏 = 空层不吞 AI 卡", async () => {
    expect(await readFeatureCards(D14)).toBeNull();
    disk.set(AI, JSON.stringify({ version: 1, cards: aiCards }));
    disk.set(USER, "{broken");
    const r = await readFeatureCards(D14);
    expect(r?.origin).toBe("ai");
    expect(r?.file.cards).toHaveLength(2);
  });
});

describe("validateFeatureCards", () => {
  const known = new Set(["s1", "s2"]);

  it("未命中引用标 unverified", () => {
    const r = validateFeatureCards({
      version: 1,
      cards: [
        { title: "A", summary: "a", sessions: ["s1"] },
        { title: "B", summary: "b", sessions: ["s2", "ghost"] },
      ],
    }, known);
    expect(r?.cards[0].unverified).toBe(false);
    expect(r?.cards[1].unverified).toBe(true);
  });

  it("档缺失/损坏/version 不符 = null", () => {
    expect(validateFeatureCards(null, known)).toBeNull();
    expect(validateFeatureCards({}, known)).toBeNull();
    expect(validateFeatureCards({ version: 2, cards: [] }, known)).toBeNull();
    expect(validateFeatureCards({ version: 1 }, known)).toBeNull();
  });
});
