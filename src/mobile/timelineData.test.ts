/**
 * 时间线缓存+增量扫描回归锚(2026-10-06 外网链路慢优化):
 * 追加 → 只扫增量(无 0 起点 range)/ 截断 → 全量 / 边界 id 不符 → 全量 /
 * resolve 落空用缓存 path 探活(治「查不到」)/ 缓存 text 落 clipText 形态。
 * mock:@kernel/ipc(mini Rust 行对齐语义互证)、./sessionFile 的 resolveTranscriptPath。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  path: "/s/omp/s1.jsonl" as string | null,
  files: new Map<string, Uint8Array>(),
  rangeCalls: [] as { start: number; maxBytes: number }[],
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/Users/x",
    fsReadTailChanged: async (path: string) => {
      const buf = h.files.get(path);
      if (!buf) throw new Error("no such file");
      return { changed: true, size: buf.length, text: "" };
    },
    fsReadRange: async (path: string, start: number, maxBytes: number) => {
      h.rangeCalls.push({ start, maxBytes });
      const buf = h.files.get(path);
      if (!buf || start >= buf.length) return { text: "", consumed: 0 };
      const want = Math.min(maxBytes, buf.length - start);
      const slice = buf.slice(start, start + want);
      const atEof = start + want >= buf.length;
      let keep = want;
      if (!atEof && slice[want - 1] !== 0x0a) {
        let last = -1;
        for (let i = want - 1; i >= 0; i--)
          if (slice[i] === 0x0a) {
            last = i;
            break;
          }
        keep = last + 1;
      }
      return { text: new TextDecoder().decode(slice.slice(0, keep)), consumed: keep };
    },
  },
}));

vi.mock("./sessionFile", () => ({
  resolveTranscriptPath: async () => h.path,
  parseTurnsFromText: () => [],
}));

vi.mock("@kernel/transport", () => ({ serverHostId: () => "host-a" }));

const lsMap = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => lsMap.get(k) ?? null,
  setItem: (k: string, v: string) => void lsMap.set(k, v),
  removeItem: (k: string) => void lsMap.delete(k),
});

import { loadTimelineAll } from "./timelineData";

const enc = new TextEncoder();
const PATH = "/s/omp/s1.jsonl";
const msg = (id: string, text: string) =>
  JSON.stringify({ type: "message", id, message: { role: "user", content: text } });
/** 行集 → jsonl 字节(行尾 \n)。 */
const jsonl = (lines: string[]) => enc.encode(lines.map((l) => `${l}\n`).join(""));

beforeEach(() => {
  h.path = PATH;
  h.files.clear();
  h.rangeCalls = [];
  lsMap.clear();
});

const load = (onPartial?: (entries: unknown[], p: unknown) => void) =>
  loadTimelineAll("omp", "/repo", "s1", onPartial);

describe("loadTimelineAll 缓存+增量", () => {
  it("首拍全量回写缓存;追加后二拍只扫增量(锚校验 + 正向段,无 0 起点 range)", async () => {
    h.files.set(PATH, jsonl([msg("m1", "甲"), msg("m2", "乙"), msg("m3", "丙")]));
    const first = await load();
    expect(first?.entries.map((e) => e.id)).toEqual(["m1", "m2", "m3"]);

    h.rangeCalls = [];
    const buf = h.files.get(PATH)!;
    const grown = new Uint8Array(buf.length + enc.encode(`${msg("m4", "丁")}\n`).length);
    grown.set(buf);
    grown.set(enc.encode(`${msg("m4", "丁")}\n`), buf.length);
    h.files.set(PATH, grown);

    const partials: string[][] = [];
    const second = await load((entries) =>
      partials.push((entries as { id: string }[]).map((e) => e.id)),
    );
    expect(second?.entries.map((e) => e.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(second?.capped).toBe(false);
    /* 增量路 = 锚校验(last.offset)+ 1 正向段;全量路会有一次 0 起点 range。 */
    expect(h.rangeCalls.length).toBe(2);
    expect(h.rangeCalls.every((c) => c.start > 0)).toBe(true);
    expect(partials.length).toBeGreaterThan(0); /* onPartial 照发 */
  });

  it("截断(size < scannedSize)→ 全量重扫", async () => {
    h.files.set(PATH, jsonl([msg("m1", "甲"), msg("m2", "乙"), msg("m3", "丙")]));
    await load();
    h.rangeCalls = [];
    h.files.set(PATH, jsonl([msg("n1", "新")]));
    const r = await load();
    expect(r?.entries.map((e) => e.id)).toEqual(["n1"]);
    expect(h.rangeCalls.some((c) => c.start === 0)).toBe(true); /* 全量路特征 */
  });

  it("尺寸未缩但边界 id 不符(resume 新文件/他端改写)→ 全量重扫", async () => {
    h.files.set(PATH, jsonl([msg("m1", "甲"), msg("m2", "乙"), msg("m3", "丙")]));
    await load();
    h.rangeCalls = [];
    /* 等长改写:id 全换,尺寸 ≥ scannedSize,锚校验必须拦下。 */
    h.files.set(PATH, jsonl([msg("x1", "甲"), msg("x2", "乙"), msg("x3", "丁")]));
    const r = await load();
    expect(r?.entries.map((e) => e.id)).toEqual(["x1", "x2", "x3"]);
    expect(h.rangeCalls.some((c) => c.start === 0)).toBe(true);
  });

  it("resolve 落空:缓存 path 探活成功 → 用缓存续走(治「查不到」);探活失败 → null", async () => {
    h.files.set(PATH, jsonl([msg("m1", "甲"), msg("m2", "乙")]));
    await load();
    h.path = null; /* 定位链失败(懒落盘/身份竞态) */
    h.rangeCalls = [];
    const r = await load();
    expect(r?.path).toBe(PATH);
    expect(r?.entries.map((e) => e.id)).toEqual(["m1", "m2"]);
    expect(h.rangeCalls.some((c) => c.start === 0)).toBe(false); /* 走的增量路,未全量 */
    h.files.delete(PATH); /* 文件真没了:探活失败 */
    expect(await load()).toBeNull();
  });

  it("缓存条目 text 落 clipText 形态(锚幂等,长文本被裁)", async () => {
    const long = "长".repeat(800);
    h.files.set(PATH, jsonl([msg("m1", long)]));
    await load();
    const cached = JSON.parse(lsMap.get("tmd.m.tl.v1")!);
    const entry = cached.data["omp:s1"].entries[0];
    expect(entry.text.length).toBe(601); /* 600 + … */
    /* 缓存读回再扫:clipText 幂等,锚校验照常通过(增量路,条目不再变形)。 */
    const r = await load();
    expect(r?.entries[0].text.length).toBe(601);
    expect(r?.entries[0].id).toBe("m1");
  });
});
