/**
 * 时间线数据层测试(spec 2026-10-05-mobile-session-timeline 二轮全程):
 * 支持面分发 / loadTimelineAll 分段协议(fs_read_range 行对齐 + consumed 续读,
 * mock 侧实现 mini Rust 同语义互证)/ offset 字节累计(UTF-8)/ 渐进回调 /
 * 段数护栏 capped / loadHistoryRange 定位段。定位链细节由 sessionFile.test.ts 另钉。
 */
import { describe, expect, it, vi } from "vitest";
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/Users/x",
    fsReadTailChanged: async (path: string, maxBytes: number) => {
      return invokeMock("fs_read_tail_changed", { path, maxBytes, lastSize: null });
    },
    fsReadRange: async (path: string, start: number, maxBytes: number) => {
      return invokeMock("fs_read_range", { path, start, maxBytes });
    },
  },
}));

/* mini Rust:fs_read_range 同语义(行对齐 + consumed;见 fs_tail.rs read_range)。 */
const files = new Map<string, Uint8Array>();
let rangeCalls = 0;
const enc = new TextEncoder();
const dec = new TextDecoder();

async function invokeMock(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (cmd === "fs_read_tail_changed") {
    const buf = files.get(String(args.path));
    return { changed: true, size: buf?.length ?? 0, text: "" };
  }
  if (cmd === "fs_read_range") {
    rangeCalls++;
    if (rangeThrow) throw new Error("bridge down");
    const buf = files.get(String(args.path));
    if (!buf || (args.start as number) >= buf.length) return { text: "", consumed: 0 };
    const start = args.start as number;
    const want = Math.min((args.maxBytes as number), buf.length - start);
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
    return { text: dec.decode(slice.slice(0, keep)), consumed: keep };
  }
  if (cmd === "config_home_dir") return "/Users/x";
  if (cmd === "fs_collect_files") return [];
  return [];
}

vi.mock("@kernel/transport", () => ({
  invoke: (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "fs_read_tail" || cmd === "fs_read_file" || cmd === "fs_read_head") return "";
    if (cmd === "fs_read_tail_changed" || cmd === "fs_read_range") return invokeMock(cmd, args);
    if (cmd === "config_home_dir") return "/Users/x";
    /* fs_collect_files:目录匹配 cwd 的 omp 会话文件表。 */
    if (cmd === "fs_collect_files") {
      /* 目录扫描感知 files 磁盘态:文件未入 map = 未落盘(懒落盘用例)。 */
      return files.has(PATH)
        ? [{ name: `2026-10-05T10-00-00-000Z_${SID}.jsonl`, path: PATH, modifiedAt: Date.now() }]
        : [];
    }
    return [];
  },
}));

import { loadHistoryRange, loadTimelineAll, timelineSupported, type TimelineEntry } from "./timelineData";

const CWD = "/Users/x/code/tmd-cli";
const SID = "11111111-2222-4333-8444-555555555555";
const PATH = `/Users/x/.local/state/omp/${SID}.jsonl`;

function ompUser(id: string, text: string): string {
  return JSON.stringify({ type: "message", id, message: { role: "user", content: [{ type: "text", text }] } });
}
function ompOther(id: string): string {
  return JSON.stringify({ type: "message", id, message: { role: "assistant", content: [{ type: "text", text: "答" }] } });
}
function putFile(lines: string[]): void {
  files.set(PATH, enc.encode(lines.join("\n") + "\n"));
}

describe("timelineSupported(第五格置灰判据)", () => {
  it("契约引擎亮(大小写不敏感);契约外与缺省灰", () => {
    for (const p of ["omp", "pi", "claude", "cl", "codex", "kimi", "OMP"]) expect(timelineSupported(p)).toBe(true);
    for (const p of ["qoder", "grok", "dsh", "opencode", "shell", undefined]) {
      expect(timelineSupported(p)).toBe(false);
    }
  });
});

describe("loadTimelineAll(分段全程:行对齐 + consumed 续读 + offset)", () => {
  it("单段:按 id 绑定文件,用户消息按文件序(最旧在前)带字节 offset", async () => {
    putFile([ompUser("m1", "第一问"), ompOther("m2"), ompUser("m3", "第二问")]);
    const r = await loadTimelineAll("omp", CWD, SID);
    expect(r?.path).toBe(PATH);
    expect(r?.entries.map((e) => e.id)).toEqual(["m1", "m3"]);
    expect(r?.entries[0]?.offset).toBe(0);
    expect(r?.capped).toBe(false);
    /* offset 指向消息行首:mini Rust 按该 offset 读出的行重新解析 = 同 id。 */
    const first = r?.entries[0] as TimelineEntry;
    const second = r?.entries[1] as TimelineEntry;
    expect(second.offset).toBe(
      enc.encode(ompUser("m1", "第一问") + "\n").length + enc.encode(ompOther("m2") + "\n").length,
    );
    expect(first.text).toBe("第一问");
  });

  it("多段跨界:行不被段边界截丢,UTF-8 字节 offset 精确(汉字≠字符数)", async () => {
    /* 大 assistant 行撑文件超 384KB,用户消息跨界分布;文本带汉字验字节口径。 */
    const big = 380 * 1024;
    const filler = "x".repeat(big);
    putFile([
      ompUser("m1", "古老的中文问题"),
      ompOther("m2-pad"),
      JSON.stringify({ type: "message", id: "m-pad", message: { role: "assistant", content: [{ type: "text", text: filler }] } }),
      ompUser("m3", "新问题"),
    ]);
    const partials: number[] = [];
    const r = await loadTimelineAll("omp", CWD, SID, (_e, p) => partials.push(p.loaded));
    expect(r?.entries.map((e) => e.id)).toEqual(["m1", "m3"]);
    /* offset 精确性:从 m3.offset 起读一段,首行解析即 m3。 */
    const m3 = r?.entries[1] as TimelineEntry;
    const span = await invokeMock("fs_read_range", { path: PATH, start: m3.offset, maxBytes: 4096 }) as { text: string };
    const firstLine = span.text.split("\n")[0];
    expect(JSON.parse(firstLine).id).toBe("m3");
    /* 渐进:loaded 单调不减,末值 = 文件总字节。 */
    for (let i = 1; i < partials.length; i++) expect(partials[i]).toBeGreaterThanOrEqual(partials[i - 1]);
    const size = files.get(PATH)?.length ?? 0;
    expect(partials[partials.length - 1]).toBe(size);
    expect(rangeCalls).toBeGreaterThanOrEqual(2);
  });

  it("段数护栏:超 64 段停扫,capped=true 且保留已扫条目", async () => {
    /* 25MB 超长单行(0x78,行间有 \n 分隔,同真实 jsonl 行边界)+ 尾部真行:
     * 65 段快进耗尽护栏。 */
    const dead = new Uint8Array(25 * 1024 * 1024).fill(0x78);
    const tail = enc.encode("\n" + ompUser("m-tail", "尾部消息") + "\n");
    const whole = new Uint8Array(dead.length + tail.length);
    whole.set(dead, 0);
    whole.set(tail, dead.length);
    files.set(PATH, whole);
    const r = await loadTimelineAll("omp", CWD, SID);
    expect(r?.capped).toBe(true);
    expect(r?.entries.map((e) => e.id)).toEqual(["m-tail"]);
  });

  it("文件未找到(jsonl 懒落盘)→ null;读取失败 → reject", async () => {
    files.delete(PATH);
    const r = await loadTimelineAll("omp", CWD, "99999999-9999-4999-8999-999999999999");
    expect(r).toBeNull();
    putFile([ompUser("m1", "问")]);
    rangeThrow = true;
    await expect(loadTimelineAll("omp", CWD, SID)).rejects.toBeTruthy();
    rangeThrow = false;
  });
});

describe("loadHistoryRange(历史定位段)", () => {
  it("围绕 offset 的快照 turns + 锚文本 clipText 归一", async () => {
    const long = "长需求".repeat(300); /* 900 字,超 TURN_MAX=600 */
    putFile([ompUser("m1", long), ompOther("m2"), ompUser("m3", "第二问")]);
    const probe = await loadTimelineAll("omp", CWD, SID);
    const m1 = probe?.entries[0] as TimelineEntry;
    const r = await loadHistoryRange(PATH, m1);
    expect(r.turns.some((t) => t.role === "user" && t.text === r.anchorText)).toBe(true);
    expect(r.anchorText.length).toBeLessThanOrEqual(601); /* 600 + 省略号 */
  });
});

/* range 异常注入(读取失败用例) */
let rangeThrow = false;
