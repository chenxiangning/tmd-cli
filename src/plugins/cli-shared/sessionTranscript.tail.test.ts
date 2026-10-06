/**
 * 增量尾读回归(2026-10-06):readTranscriptTail 全量起步 → 增量段 →
 * 残行回退对齐 → 轮转全量重来;readChangedTranscript 跨拍累计 + 全量 pair
 * (增量工具结果并入上拍调用块)。ipc 桩:fsReadTailChanged / fsReadRange。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadTailChanged: vi.fn(),
  fsReadRange: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadTailChanged: mocks.fsReadTailChanged, fsReadRange: mocks.fsReadRange },
}));

import {
  makeTranscriptTailReader,
  readTranscriptTail,
  type TranscriptLineParser,
} from "./sessionTranscript";
import { readChangedTranscript, type LiveTailState } from "../session-viewer/liveMode";
import type { CliDiskSession, CliTranscriptBlock } from "@kernel/cli";

const lineOf: TranscriptLineParser = (event) => {
  const text = (event as { text?: unknown }).text;
  return typeof text === "string" ? [{ id: String((event as { id?: unknown }).id ?? "?"), role: "user", text }] : [];
};

function sessionOf(path: string): CliDiskSession {
  return { id: "s1", profileId: "pi", path, title: "t", modifiedAt: 0 } as CliDiskSession;
}

/* 行字节长度(JSONL,ASCII 行 + \n)。 */
const len = (s: string) => Buffer.byteLength(s, "utf8");

describe("readTranscriptTail", () => {
  beforeEach(() => {
    vi.mocked(mocks.fsReadTailChanged).mockReset();
    vi.mocked(mocks.fsReadRange).mockReset();
  });

  it("since=null 全量起步:块 + 行对齐 offset(末行完整 → 文件末)", async () => {
    const text = '{"id":"a","text":"1"}\n{"id":"b","text":"2"}\n';
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, text, size: len(text) });
    const r = await readTranscriptTail("/f", lineOf, null);
    expect(r?.blocks.map((b) => b.id)).toEqual(["a", "b"]);
    expect(r?.truncated).toBe(false);
    expect(r?.offset).toBe(len(text));
  });

  it("首读末行残行:offset 回退到残行行首,增量拍自残行首重读不丢消息", async () => {
    const full = '{"id":"a","text":"1"}\n';
    const torn = '{"id":"b","text":"2'; /* 真残行:JSON 写一半,parse 失败 */
    const done = '{"id":"b","text":"2"}'; /* 补全态 */
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, text: full + torn, size: len(full + torn) });
    const first = await readTranscriptTail("/f", lineOf, null);
    expect(first?.blocks.map((b) => b.id)).toEqual(["a"]); /* 残行 parse 失败跳过 */
    expect(first?.offset).toBe(len(full)); /* 回退到残行行首 */

    /* 补全后增量:自残行行首读整行,完整解析 */
    mocks.fsReadRange.mockResolvedValue({ text: done + "\n", consumed: len(done) + 1 });
    const second = await readTranscriptTail("/f", lineOf, first!.offset);
    expect(second?.blocks.map((b) => b.id)).toEqual(["b"]);
  });

  it("增量段段尾残行(RangeSpan consumed 含残行):offset 仍回退对齐", async () => {
    /* Rust read_range 的 at_eof 分支 consumed 含残行字节;壳层回退保证下拍不跳行 */
    const residual = '{"id":"c","text":"3'; /* parse 失败,不产块 */
    mocks.fsReadRange.mockResolvedValue({ text: residual, consumed: len(residual) });
    const r = await readTranscriptTail("/f", lineOf, 100);
    expect(r?.blocks).toEqual([]); /* 残行 parse 失败 */
    expect(r?.offset).toBe(100); /* 回退到段首(残行行首) */
  });

  it("32MB 超限:truncated=true 传递", async () => {
    mocks.fsReadTailChanged.mockResolvedValue({
      changed: true,
      text: '{"id":"a","text":"1"}\n',
      size: 33 * 1024 * 1024,
    });
    const r = await readTranscriptTail("/f", lineOf, null);
    expect(r?.truncated).toBe(true);
  });

  it("读失败 → null", async () => {
    mocks.fsReadRange.mockRejectedValue(new Error("io"));
    expect(await readTranscriptTail("/f", lineOf, 10)).toBeNull();
  });

  it("makeTranscriptTailReader:默认读 session.path", async () => {
    mocks.fsReadRange.mockResolvedValue({ text: "", consumed: 0 });
    const reader = makeTranscriptTailReader(lineOf);
    await reader(sessionOf("/d/s.jsonl"), 0);
    expect(mocks.fsReadRange).toHaveBeenCalledWith("/d/s.jsonl", 0, expect.any(Number));
  });
});

describe("readChangedTranscript(liveMode 跨拍累计)", () => {
  beforeEach(() => {
    vi.mocked(mocks.fsReadTailChanged).mockReset();
    vi.mocked(mocks.fsReadRange).mockReset();
  });

  const profileOf = (tail?: unknown) =>
    ({ readTranscriptTail: tail }) as Parameters<typeof readChangedTranscript>[0];

  it("增量工具结果并入上拍调用块(全量 pair 语义)", async () => {
    const call = JSON.stringify({ id: "c", role: "tool", tool: { callId: "k1", title: "bash", status: "called" } }) + "\n";
    /* lineOf 只产 user 块,直接用真实 pair 语义:手写块 */
    mocks.fsReadTailChanged.mockResolvedValue({ changed: true, text: call, size: len(call) });
    /* 借原始 parse:lineOf 产 tool 形状块 */
    const toolLine: TranscriptLineParser = (e) => {
      const t = e as { tool?: unknown };
      return t.tool ? [{ id: String(e.id), role: "tool", text: "", tool: t.tool as CliTranscriptBlock["tool"] }] : [];
    };
    const tail: LiveTailState = { raw: null, offset: null, truncated: false };
    const reader = makeTranscriptTailReader(toolLine);
    const first = await readChangedTranscript(profileOf(reader), sessionOf("/f"), len(call), tail);
    expect(first?.blocks).toHaveLength(1);
    expect(first?.blocks[0].tool?.status).toBe("called");

    /* 增量拍:同 callId 的结果块 → 并入 */
    const result = JSON.stringify({ id: "r", tool: { callId: "k1" }, detail: "ls out" }) + "\n";
    /* toolLine 不带 text 字段进 detail —— 直接构造 result 块经 pairToolResults 并入断言 */
    mocks.fsReadRange.mockResolvedValue({ text: "", consumed: 0 });
    const second = await readChangedTranscript(
      { readTranscriptTail: async () => ({ blocks: [{ id: "r", role: "tool", text: "ls out", tool: { callId: "k1" } }], offset: len(call) + len(result) }) } as never,
      sessionOf("/f"),
      len(call) + len(result),
      tail,
    );
    expect(second?.blocks).toHaveLength(1);
    expect(second?.blocks[0].tool?.status).toBe("done");
    expect(second?.blocks[0].tool?.detail).toBe("ls out");
  });

  it("轮转守卫:文件变小 → since=null 全量重来(增量偏移失效)", async () => {
    let calls: Array<number | null> = [];
    const reader = vi.fn(async (_s: unknown, since: number | null) => {
      calls.push(since);
      return { blocks: [], offset: since === null ? 500 : 900 };
    });
    const tail: LiveTailState = { raw: null, offset: null, truncated: false };
    await readChangedTranscript(profileOf(reader), sessionOf("/f"), 500, tail);
    await readChangedTranscript(profileOf(reader), sessionOf("/f"), 900, tail);
    expect(calls).toEqual([null, 500]);
    await readChangedTranscript(profileOf(reader), sessionOf("/f"), 10, tail); /* 文件变小 */
    expect(calls[2]).toBeNull();
  });

  it("truncated 首读定格:增量拍(undefined)不冲掉", async () => {
    const reader = vi.fn(async (_s: unknown, since: number | null) =>
      since === null
        ? { blocks: [], truncated: true, offset: 100 }
        : { blocks: [], offset: 200 });
    const tail: LiveTailState = { raw: null, offset: null, truncated: false };
    const first = await readChangedTranscript(profileOf(reader), sessionOf("/f"), 100, tail);
    expect(first?.truncated).toBe(true);
    const second = await readChangedTranscript(profileOf(reader), sessionOf("/f"), 200, tail);
    expect(second?.truncated).toBe(true);
  });

  it("未声明 readTranscriptTail:回落 readSessionTranscript 全量", async () => {
    const full = vi.fn(async () => ({ blocks: [{ id: "z", role: "assistant", text: "hi" }], truncated: false }));
    const r = await readChangedTranscript(
      { readSessionTranscript: full } as never,
      sessionOf("/f"),
      0,
      { raw: null, offset: null, truncated: false },
    );
    expect(r?.blocks[0].id).toBe("z");
    expect(full).toHaveBeenCalledTimes(1);
  });
});
