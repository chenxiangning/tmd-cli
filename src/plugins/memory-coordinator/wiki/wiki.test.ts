/** agent wiki 纯逻辑测试:解析兜底 / 幂等追加 / 摘录截断 / 序列化 roundtrip。 */
import { describe, expect, it } from "vitest";
import { addEntry, excerptFromMsgs, parseWikiDoc, serializeWikiDoc } from "./wiki";

const base = { id: "e1", ts: 1, harness: "omp", sessionId: "s1", excerpt: "hello", kind: "auto" as const };

describe("parseWikiDoc", () => {
  it("坏 JSON 回空文档不抛", () => {
    expect(parseWikiDoc("not json{")).toEqual({ version: 1, entries: [] });
  });
  it("形状不合法的条目(缺 id/kind 拼坏)被丢弃", () => {
    const bad = { version: 1, entries: [{ ts: 1, harness: "omp", sessionId: "s1", excerpt: "x", kind: "bogus" }] };
    expect(parseWikiDoc(JSON.stringify(bad))).toEqual({ version: 1, entries: [] });
    const good = parseWikiDoc(JSON.stringify({ version: 1, entries: [base] }));
    expect(good.entries).toHaveLength(1);
  });
  it("版本不符回空文档不抛", () => {
    expect(parseWikiDoc(JSON.stringify({ version: 2, entries: [base] }))).toEqual({
      version: 1,
      entries: [],
    });
  });
  it("entries 缺失回空文档", () => {
    expect(parseWikiDoc(JSON.stringify({ version: 1 }))).toEqual({ version: 1, entries: [] });
  });
  it("合法文档原样解析", () => {
    const doc = { version: 1, entries: [base] };
    expect(parseWikiDoc(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("addEntry 幂等", () => {
  it("同 sessionId 的 auto 已存在则不重", () => {
    const doc = addEntry({ version: 1, entries: [] }, base);
    const again = addEntry(doc, base);
    expect(again).toBe(doc);
    expect(doc.entries).toHaveLength(1);
  });
  it("不同 sessionId 的 auto 各写一条", () => {
    let doc = addEntry({ version: 1, entries: [] }, base);
    doc = addEntry(doc, { ...base, sessionId: "s2" });
    expect(doc.entries).toHaveLength(2);
  });
  it("decision/open 不做会话幂等", () => {
    let doc = addEntry({ version: 1, entries: [] }, { ...base, kind: "decision" });
    doc = addEntry(doc, { ...base, kind: "decision" });
    expect(doc.entries).toHaveLength(2);
  });
  it("新条目带 id", () => {
    const doc = addEntry({ version: 1, entries: [] }, base);
    expect(doc.entries[0]?.id).toBeTruthy();
  });
});

describe("excerptFromMsgs", () => {
  it("尾段拼接;超 800 字保尾部截断", () => {
    const long = Array.from({ length: 60 }, (_, i) => `m${i}`);
    const out = excerptFromMsgs(long.map((text) => ({ text })));
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith("m59")).toBe(true);
  });
  it("短消息原样拼接", () => {
    expect(excerptFromMsgs([{ text: "a" }, { text: "b" }])).toBe("a\n---\nb");
  });
});

describe("serialize roundtrip", () => {
  it("serialize → parse 还原条目", () => {
    const doc = addEntry({ version: 1, entries: [] }, base);
    expect(parseWikiDoc(serializeWikiDoc(doc))).toEqual(doc);
  });
});
