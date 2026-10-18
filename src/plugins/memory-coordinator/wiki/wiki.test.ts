/** agent wiki 纯逻辑测试:解析兜底 / 幂等追加 / 摘录截断 / 序列化 roundtrip。 */
import { describe, expect, it } from "vitest";
import { addEntry, excerptFromMsgs, isMissingReadErr, parseWikiDoc, serializeWikiDoc, type WikiDoc } from "./wiki";

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
  it("尾段拼接;超 800 字真触发保尾截断(总量确超上限)", () => {
    const long = Array.from({ length: 60 }, (_, i) => `m${i}`);
    const out = excerptFromMsgs(long.map((text) => ({ text })));
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith("m59")).toBe(true);
  });
  it("单条超 800 字:只留尾部 800 字,开头被截掉", () => {
    const text = `${"x".repeat(900)}TAIL`;
    const out = excerptFromMsgs([{ text }]);
    expect(out).toBe(`${"x".repeat(796)}TAIL`);
    expect(out.length).toBe(800);
  });
  it("短消息原样拼接", () => {
    expect(excerptFromMsgs([{ text: "a" }, { text: "b" }])).toBe("a\n---\nb");
  });
});

describe("addEntry 上限剪枝", () => {
  it("超 500 条剪最旧 auto,decision/open 保留", () => {
    let doc: WikiDoc = { version: 1, entries: [] };
    /* 3 条 decision 打头(新,保留),再灌 499 条 auto → 总量 502,应剪 2 条最旧 auto。 */
    for (let i = 0; i < 3; i += 1) {
      doc = addEntry(doc, { ts: i, harness: "omp", sessionId: `d${i}`, excerpt: `d${i}`, kind: "decision" });
    }
    for (let i = 0; i < 499; i += 1) {
      doc = addEntry(doc, { ts: 100 + i, harness: "omp", sessionId: `a${i}`, excerpt: `a${i}`, kind: "auto" });
    }
    expect(doc.entries).toHaveLength(500);
    expect(doc.entries.filter((e) => e.kind === "decision")).toHaveLength(3);
    const autos = doc.entries.filter((e) => e.kind === "auto");
    expect(autos[0]?.sessionId).toBe("a2"); /* a0/a1 被剪,a2 起保留 */
    expect(autos.at(-1)?.sessionId).toBe("a498");
  });
});

describe("isMissingReadErr", () => {
  it("unix ENOENT 与 Windows os error 2/3 均判缺失;其余错误不判", () => {
    expect(isMissingReadErr("读取文件信息失败: No such file or directory (os error 2)")).toBe(true);
    expect(isMissingReadErr("读取文件信息失败: 系统找不到指定的文件。 (os error 2)")).toBe(true);
    expect(isMissingReadErr("读取文件信息失败: 系统找不到指定的路径。 (os error 3)")).toBe(true);
    expect(isMissingReadErr("读取文件信息失败: Too many open files (os error 24)")).toBe(false);
    expect(isMissingReadErr("读取文件信息失败: Permission denied (os error 13)")).toBe(false);
  });
});

describe("serialize roundtrip", () => {
  it("serialize → parse 还原条目", () => {
    const doc = addEntry({ version: 1, entries: [] }, base);
    expect(parseWikiDoc(serializeWikiDoc(doc))).toEqual(doc);
  });
});
