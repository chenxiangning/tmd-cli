/**
 * 通知流水纯函数契约:坏文件解析、追加剪枝(过期/上限)、面板今日分组。
 * 模块级纯函数,直接 import 无需环境桩。
 */
import { describe, expect, it } from "vitest";
import {
  ENTRIES_MAX,
  appendEntry,
  groupNotifyEntries,
  parseNotifyLog,
  type NotifyDoc,
  type NotifyEntry,
} from "./log";

const mk = (ts: number, kind: NotifyEntry["kind"] = "ask"): Omit<NotifyEntry, "id"> => ({
  ts,
  kind,
  sessionId: "s1",
  title: "等待确认",
  snippet: "「x」在等你确认操作",
});

describe("parseNotifyLog(坏文件不抛)", () => {
  it("坏 JSON / version 不符 / entries 非数组 → 空文档", () => {
    expect(parseNotifyLog("not json")).toEqual({ version: 1, entries: [] });
    expect(parseNotifyLog('{"version":2,"entries":[]}')).toEqual({ version: 1, entries: [] });
    expect(parseNotifyLog('{"version":1,"entries":{}}')).toEqual({ version: 1, entries: [] });
  });

  it("形状不合法的条目逐条弃,合法保留", () => {
    const text = JSON.stringify({
      version: 1,
      entries: [
        { id: "a", ts: 1, kind: "ask", sessionId: "s1", title: "t" },
        { id: "", ts: 2, kind: "ask", sessionId: "s1", title: "t" }, // 空 id 弃
        { id: "b", ts: 3, kind: "bogus", sessionId: "s1", title: "t" }, // 类别坏弃
        { id: "c", ts: "4", kind: "ask", sessionId: "s1", title: "t" }, // ts 坏弃
        "junk", // 非对象弃
      ],
    });
    const doc = parseNotifyLog(text);
    expect(doc.entries.map((e) => e.id)).toEqual(["a"]);
  });
});

describe("appendEntry(追加 + 过期/上限双闸)", () => {
  const DAY = 86_400_000;

  it("追加生成 id,原条目不动", () => {
    const doc = appendEntry({ version: 1, entries: [] }, mk(100), 200, 7);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0].id).toBeTruthy();
    expect(doc.entries[0].ts).toBe(100);
  });

  it("过期过滤:ts < now - maxDays 剪除,恰好边界保留", () => {
    const now = 10 * DAY;
    const doc = appendEntry(
      {
        version: 1,
        entries: [
          { id: "old", ts: now - 8 * DAY, kind: "ask", sessionId: "s", title: "t" },
          { id: "edge", ts: now - 7 * DAY, kind: "ask", sessionId: "s", title: "t" },
          { id: "fresh", ts: now - DAY, kind: "ask", sessionId: "s", title: "t" },
        ],
      },
      mk(now),
      now,
      7,
    );
    expect(doc.entries.map((e) => e.id)).toEqual(["edge", "fresh", expect.any(String)]);
  });

  it("条数上限:超 ENTRIES_MAX 从最旧剪", () => {
    let doc: NotifyDoc = { version: 1, entries: [] };
    for (let i = 0; i < ENTRIES_MAX + 10; i++) doc = appendEntry(doc, mk(i), i + DAY, 365);
    expect(doc.entries).toHaveLength(ENTRIES_MAX);
    expect(doc.entries[0].ts).toBe(10); // 最旧 10 条被剪
    expect(doc.entries.at(-1)!.ts).toBe(ENTRIES_MAX + 9);
  });
});

describe("groupNotifyEntries(面板今日/更早分组)", () => {
  it("按本地日历日分今日/更早,组内最新在前", () => {
    const now = new Date(2026, 9, 18, 12, 0); // 本地 2026-10-18 12:00
    const entries: NotifyEntry[] = [
      { id: "a", ts: new Date(2026, 9, 17, 23, 59).getTime(), kind: "ask", sessionId: "s", title: "t" },
      { id: "b", ts: new Date(2026, 9, 18, 0, 0).getTime(), kind: "turn", sessionId: "s", title: "t" },
      { id: "c", ts: new Date(2026, 9, 18, 11, 0).getTime(), kind: "exit", sessionId: "s", title: "t" },
      { id: "d", ts: new Date(2026, 9, 15, 8, 0).getTime(), kind: "quota", sessionId: "s", title: "t" },
    ];
    const g = groupNotifyEntries(entries, now);
    expect(g.today.map((e) => e.id)).toEqual(["c", "b"]); // 最新在前
    expect(g.earlier.map((e) => e.id)).toEqual(["a", "d"]);
  });

  it("空流水 → 两组皆空", () => {
    expect(groupNotifyEntries([], new Date())).toEqual({ today: [], earlier: [] });
  });
});
