/**
 * diskCache 回归锚:信封读写 / host 不符 = miss(多桌面防串)/ 版本 miss /
 * 坏 JSON 吞 / pruneLru 裁剪 / 写失败逐最旧重试一次再放弃 /
 * home 历史每 root 截 60 / transcript LRU 20。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* serverHostId 可变:用 hoisted 容器,各用例按需换身份。 */
const h = vi.hoisted(() => ({ host: "host-a" as string | null }));
vi.mock("@kernel/transport", () => ({ serverHostId: () => h.host }));

import {
  pruneLru,
  readCache,
  readHomeHistory,
  readTranscriptCache,
  writeCache,
  writeHomeHistoryRoot,
  writeTranscriptCache,
} from "./diskCache";
import type { HistoryItem } from "./history";

/** localStorage stub 形态:Map 底 + length/key(i)(dropOldest 枚举用)+ 可控写失败次数。 */
interface FakeLs {
  map: Map<string, string>;
  readonly length: number;
  key: (i: number) => string | null;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}

function fakeLs(failWrites = 0, map = new Map<string, string>()): FakeLs {
  let fails = failWrites;
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (fails-- > 0) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

let ls: FakeLs;
beforeEach(() => {
  h.host = "host-a";
  ls = fakeLs();
  vi.stubGlobal("localStorage", ls);
});

const histItem = (id: string, modifiedAt: number): HistoryItem => ({
  profileId: "omp",
  session: { id, modifiedAt, path: `/p/${id}.jsonl` },
});

describe("信封读写", () => {
  it("round-trip:写入可读回,host/at 由内部打", () => {
    writeCache("tmd.m.x.v1", { a: 1 });
    expect(readCache<{ a: number }>("tmd.m.x.v1")).toEqual({ a: 1 });
  });
  it("host 不符 = miss(多桌面共用一台手机防串缓存)", () => {
    writeCache("tmd.m.x.v1", { a: 1 });
    h.host = "host-b";
    expect(readCache("tmd.m.x.v1")).toBeNull();
  });
  it("未连接(serverHostId = null)= unknown 桶,同桶可读写", () => {
    h.host = null;
    writeCache("tmd.m.x.v1", { a: 2 });
    expect(readCache<{ a: number }>("tmd.m.x.v1")).toEqual({ a: 2 });
    h.host = "host-a";
    expect(readCache("tmd.m.x.v1")).toBeNull(); /* unknown 桶与实名桶互不可见 */
  });
  it("版本不符/坏 JSON/异型 = miss,静默吞", () => {
    ls.map.set("tmd.m.x.v1", JSON.stringify({ v: 99, host: "host-a", at: 1, data: 1 }));
    expect(readCache("tmd.m.x.v1")).toBeNull();
    ls.map.set("tmd.m.y.v1", "{not json");
    expect(readCache("tmd.m.y.v1")).toBeNull();
    ls.map.set("tmd.m.z.v1", JSON.stringify([1, 2]));
    expect(readCache("tmd.m.z.v1")).toBeNull();
  });
});

describe("pruneLru", () => {
  it("超 max 按 at 逐最旧,保留最新 max 条", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`k${i}`, { at: i + 1, v: i }]),
    );
    const out = pruneLru(entries, 3);
    expect(Object.keys(out).sort()).toEqual(["k2", "k3", "k4"]);
  });
  it("未超 max 原样返回", () => {
    const entries = { a: { at: 1 }, b: { at: 2 } };
    expect(pruneLru(entries, 2)).toBe(entries);
  });
});

describe("写失败处理", () => {
  it("配额满:逐最旧一条 tmd.m.* 后重试成功", () => {
    const map = new Map<string, string>([
      ["tmd.m.old.v1", JSON.stringify({ v: 1, host: "host-a", at: 1, data: 1 })],
      ["tmd.other", "不相关的键不被逐"],
    ]);
    vi.stubGlobal("localStorage", fakeLs(1, map)); /* 首次 setItem 必败 */
    writeCache("tmd.m.new.v1", 2);
    expect(map.has("tmd.m.old.v1")).toBe(false); /* 最旧被逐 */
    expect(map.get("tmd.other")).toBe("不相关的键不被逐");
    expect(map.has("tmd.m.new.v1")).toBe(true); /* 重试写入成功 */
  });
  it("持续写失败:静默吞,不抛", () => {
    vi.stubGlobal("localStorage", fakeLs(99));
    expect(() => writeCache("tmd.m.x.v1", 1)).not.toThrow();
  });
});

describe("home 历史缓存", () => {
  it("每 root 按 modifiedAt 倒序截最新 60 条;分 root 独立", () => {
    const items = Array.from({ length: 70 }, (_, i) => histItem(`s${i}`, i + 1));
    writeHomeHistoryRoot("/r1", items);
    writeHomeHistoryRoot("/r2", [histItem("x", 1)]);
    const out = readHomeHistory();
    expect(out.get("/r1")?.length).toBe(60);
    expect(out.get("/r1")?.[0].session.id).toBe("s69"); /* 最新在前 */
    expect(out.get("/r1")?.[59].session.id).toBe("s10");
    expect(out.get("/r2")?.length).toBe(1);
  });
  it("空缓存 hydrate = 空 Map", () => {
    expect(readHomeHistory().size).toBe(0);
  });
});

describe("transcript 缓存", () => {
  it("round-trip + LRU 20:第 21 条写入逐最旧", () => {
    for (let i = 0; i < 20; i++) {
      writeTranscriptCache(`/p/${i}.jsonl`, 100 + i, [{ role: "user", text: `t${i}` }]);
      /* 保证 at 严格递增(同毫秒连写时序不稳):直接改落盘 at。 */
      const env = JSON.parse(ls.map.get("tmd.m.tr.v1")!);
      env.data[`/p/${i}.jsonl`].at = i + 1;
      ls.map.set("tmd.m.tr.v1", JSON.stringify(env));
    }
    writeTranscriptCache("/p/new.jsonl", 1, []);
    expect(readTranscriptCache("/p/new.jsonl")).not.toBeNull();
    expect(readTranscriptCache("/p/0.jsonl")).toBeNull(); /* 最旧被逐 */
    expect(readTranscriptCache("/p/19.jsonl")?.turns[0].text).toBe("t19");
  });
});
