/**
 * 渠道存储纯函数测试 —— round-trip + 边界 / 见 docs/superpowers/specs/2026-09-11-cli-provider-channels-design.md。
 */

import { describe, expect, it } from "vitest";
import {
  emptyChannelDoc,
  genChannelId,
  normalizeDoc,
  parseChannelDoc,
  removeChannel,
  serializeChannelDoc,
  setCurrent,
  upsertChannel,
} from "./store";
import type { Channel, ChannelDoc } from "./types";
function mkChannel(id: string, name: string, source?: "cc-switch"): Channel {
  return {
    id,
    name,
    remark: "r",
    baseUrl: "https://api.example.com",
    apiKey: "sk-test",
    model: "gpt-x",
    source,
    ccsId: source ? `ccs_${id}` : undefined,
    createdAt: 1700000000000,
  };
}

describe("parseChannelDoc / serializeChannelDoc", () => {
  it("空文本 → 空 doc", () => {
    const d = parseChannelDoc("");
    expect(d.version).toBe(1);
    expect(d.engines.claude.providers).toEqual({});
    expect(d.engines.codex.providers).toEqual({});
  });

  it("round-trip:serialize → parse 不变", () => {
    const doc: ChannelDoc = emptyChannelDoc();
    const next = upsertChannel(doc, "claude", mkChannel("a", "A"));
    const next2 = setCurrent(next, "claude", "a");
    const text = serializeChannelDoc(next2);
    const back = parseChannelDoc(text);
    expect(back.engines.claude.providers.a.name).toBe("A");
    expect(back.engines.claude.current).toBe("a");
  });

  it("坏 JSON 抛错", () => {
    expect(() => parseChannelDoc("{not json")).toThrow();
  });

  it("version 不符抛错", () => {
    expect(() => parseChannelDoc('{"version":2,"engines":{}}')).toThrow(/version/);
  });

  it("normalizeDoc 补白名单引擎", () => {
    const doc: ChannelDoc = { version: 1, engines: {} as ChannelDoc["engines"] };
    const n = normalizeDoc(doc);
    expect(n.engines.claude.providers).toEqual({});
    expect(n.engines.codex.current).toBeNull();
  });
});

describe("upsertChannel / removeChannel / setCurrent", () => {
  it("upsert 保留其它 channel", () => {
    let doc = upsertChannel(emptyChannelDoc(), "claude", mkChannel("a", "A"));
    doc = upsertChannel(doc, "claude", mkChannel("b", "B"));
    expect(Object.keys(doc.engines.claude.providers)).toEqual(["a", "b"]);
  });

  it("removeChannel 删条目,清 current 如果命中", () => {
    let doc = upsertChannel(emptyChannelDoc(), "claude", mkChannel("a", "A"));
    doc = setCurrent(doc, "claude", "a");
    const removed = removeChannel(doc, "claude", "a");
    expect(removed.engines.claude.providers).toEqual({});
    expect(removed.engines.claude.current).toBeNull();
  });

  it("setCurrent 对不存在 id 是 no-op", () => {
    const doc = emptyChannelDoc();
    const next = setCurrent(doc, "claude", "missing");
    expect(next).toBe(doc);
  });
});

describe("genChannelId", () => {
  it("生成形如 ch_xxxxxx", () => {
    expect(genChannelId()).toMatch(/^ch_[a-z0-9]{6}$/);
  });

  it("多次调用大概率不同", () => {
    const ids = new Set(Array.from({ length: 20 }, () => genChannelId()));
    expect(ids.size).toBeGreaterThan(15);
  });
});
