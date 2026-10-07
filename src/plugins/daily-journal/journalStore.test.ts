/** journalStore 持久化与派生测试(ipc mock;模块级单例走 resetModules)。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalConfig } from "./journalFiles";
const files = vi.hoisted(() => new Map<string, string>());
const ipcMock = vi.hoisted(() => ({
  configDir: vi.fn(async () => "/home/u/.tmd-cli"),
  fsReadFile: vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error("not found");
    return files.get(path)!;
  }),
  fsWriteFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  }),
  fsCreateDir: vi.fn(async () => undefined),
  fsRenameEntry: vi.fn(async (path: string, newName: string) => {
    const to = `${path.slice(0, path.lastIndexOf("/"))}/${newName}`;
    files.set(to, files.get(path)!);
    files.delete(path);
  }),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

interface StoreModule {
  bootJournal: () => Promise<void>;
  loadMonth: (y: number, m: number, force?: boolean) => Promise<void>;
  saveNote: (y: number, m: number, d: number, note: { text: string; images: never[]; updatedAt: number; checked?: boolean } | null) => Promise<void>;
  updateConfig: (patch: Partial<JournalConfig>) => void;
  addBead: (key: string, bead: { t: string; label: string }) => void;
  dayMetaOf: (key: string) => { beads: { t: string; label: string }[]; lastError?: string; updatedAt: number };
  deriveDayStatus: (a: unknown, isToday: boolean, n: number, meta: { lastError?: string }) => string;
  heatThresholds: (counts: number[]) => [number, number, number];
  heatOf: (n: number, ts: [number, number, number]) => string;
  useJournalState: () => unknown;
  journalWritesSettled: () => Promise<void>;
}

let store: StoreModule;

beforeEach(async () => {
  vi.clearAllMocks();
  files.clear();
  vi.resetModules();
  store = (await import("./journalStore")) as unknown as StoreModule;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("journalStore", () => {
  it("首启:meta 缺省配置落内存;写便签建月档;删便签清条目", async () => {
    await store.bootJournal();
    await store.loadMonth(2026, 9);
    await store.saveNote(2026, 9, 22, { text: "全天在外", images: [], updatedAt: 1 });
    expect(files.get("/home/u/.tmd-cli/daily/notes/2026-09.json")).toContain("全天在外");
    await store.saveNote(2026, 9, 22, null);
    expect(files.get("/home/u/.tmd-cli/daily/notes/2026-09.json")).toBe("{}");
  });

  it("checked 勾选态 round-trip:undefined 不落键,取消勾选回旧档形态", async () => {
    await store.bootJournal();
    await store.loadMonth(2026, 10);
    await store.saveNote(2026, 10, 6, { text: "relay 预算", images: [], updatedAt: 1, checked: true });
    const marked = files.get("/home/u/.tmd-cli/daily/notes/2026-10.json")!;
    expect(marked).toContain('"checked": true');
    await store.saveNote(2026, 10, 6, { text: "relay 预算", images: [], updatedAt: 1, checked: undefined });
    const cleared = files.get("/home/u/.tmd-cli/daily/notes/2026-10.json")!;
    expect(cleared).not.toContain("checked");
  });

  it("文章存在性进月快照;md 解析后可读标题", async () => {
    files.set(
      "/home/u/.tmd-cli/daily/article/2026-09-28.md",
      "# dsh 适配收口\n\n总览。\n\n## 排查\n\n两处破口。\n",
    );
    await store.bootJournal();
    await store.loadMonth(2026, 9);
    /* 快照经 useJournalState 的 store 面;此处直接验证 meta 持久化与 bead。 */
    store.addBead("2026-09-28", { t: "08:00", label: "定时生成 · 5 会话" });
    await store.journalWritesSettled();
    const metaJson = files.get("/home/u/.tmd-cli/daily/meta.json")!;
    expect(metaJson).toContain("定时生成 · 5 会话");
    expect(JSON.parse(metaJson).days["2026-09-28"].beads).toHaveLength(1);
  });

  it("配置补丁持久化合并(缺省字段保留)", async () => {
    files.set("/home/u/.tmd-cli/daily/meta.json", JSON.stringify({ config: { engine: "kimi" }, days: {}, tasks: [] }));
    await store.bootJournal();
    store.updateConfig({ timerTime: "09:30" });
    await store.journalWritesSettled();
    const saved = JSON.parse(files.get("/home/u/.tmd-cli/daily/meta.json")!);
    expect(saved.config.engine).toBe("kimi");
    expect(saved.config.timerTime).toBe("09:30");
    expect(saved.config.incPolicy).toBe("auto"); /* DEFAULT 补缺 */
  });

  it("日状态派生真值表", () => {
    const art = { title: "t" };
    expect(store.deriveDayStatus(art, true, 3, {})).toBe("t");
    expect(store.deriveDayStatus(art, false, 3, {})).toBe("g");
    expect(store.deriveDayStatus(null, false, 2, { lastError: "429" })).toBe("f");
    expect(store.deriveDayStatus(null, false, 2, {})).toBe("p");
    expect(store.deriveDayStatus(null, true, 0, {})).toBe("n");
    expect(store.deriveDayStatus(null, false, 0, { lastError: "x" })).toBe("f");
  });

  it("热力按当月分布分位分档:同数同档,高强度月不再整月同色", () => {
    /* 2026-09 真实分布:固定阈值(9+)下除 16/24 日外全落 h4;分位档应四档铺开。 */
    const sep = [24, 50, 23, 18, 24, 62, 12, 16, 16, 34, 38, 18, 24, 10, 18, 6, 9, 19, 22, 12, 20, 17, 8, 15, 13, 23, 20, 45, 28];
    const ts = store.heatThresholds(sep);
    expect(ts).toEqual([13, 19, 28]);
    expect(store.heatOf(6, ts)).toBe("h1");
    expect(store.heatOf(16, ts)).toBe("h2");
    expect(store.heatOf(24, ts)).toBe("h3");
    expect(store.heatOf(62, ts)).toBe("h4");
    const tiers = new Set(sep.map((c) => store.heatOf(c, ts)));
    expect(tiers.size).toBe(4); /* 层次感:四档全部出现 */
  });

  it("热力分位边界:并列值同档、零不计入、空数据兜底", () => {
    expect(store.heatThresholds([9, 9, 9, 9])).toEqual([9, 9, 9]); /* 全月同量:同数同档 */
    expect(store.heatOf(9, [9, 9, 9])).toBe("h4");
    expect(store.heatOf(5, [9, 9, 9])).toBe("h1");
    expect(store.heatThresholds([0, 0, 5])).toEqual([5, 5, 5]); /* 0 会话日不进分布 */
    expect(store.heatOf(0, [1, 2, 3])).toBe(""); /* 无会话无热力 */
    expect(store.heatThresholds([])).toEqual([1, 2, 3]); /* 空月兜底 */
  });
});
