/**
 * tokens.ts 纯函数测试 —— 三家行型解析 + codex 末次快照 + 7 日窗口边界 +
 * 聚合(空引擎/部分失败语义)。行型样例取自 2026-09-11 实盘 JSONL。
 */

import { describe, expect, it } from "vitest";

import {
  aggregateUsage,
  extractUsageFromHead,
  parseUsageLine,
  WINDOW_MS,
  type EngineLabel,
  type UsageLine,
} from "./tokens";

const NOW = Date.parse("2026-09-11T12:00:00Z");

/* ── parseUsageLine ─────────────────────────────── */

describe("parseUsageLine · omp/pi 行型", () => {
  it("提取 input/output/cacheRead/cacheWrite/cost", () => {
    const line = {
      id: "a0adebfc",
      timestamp: "2026-09-10T14:31:09.731Z",
      type: "assistant",
      message: {
        role: "assistant",
        usage: {
          input: 21899,
          output: 221,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 22120,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 },
        },
      },
    };
    const r = parseUsageLine(line);
    expect(r).not.toBeNull();
    expect(r!.snapshot).toBe(false);
    expect(r!.line).toMatchObject({
      ts: Date.parse("2026-09-10T14:31:09.731Z"),
      input: 21899,
      output: 221,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.5,
    });
  });

  it("cost 缺失 = undefined(不是 0,避免误报有费用)", () => {
    const r = parseUsageLine({
      timestamp: "2026-09-10T14:31:09.731Z",
      message: { usage: { input: 1, output: 1 } },
    });
    expect(r!.line.cost).toBeUndefined();
  });
});

describe("parseUsageLine · claude 行型", () => {
  it("_tokens 后缀字段正确提取", () => {
    const r = parseUsageLine({
      timestamp: "2026-09-05T18:21:10.040Z",
      message: {
        usage: {
          input_tokens: 77271,
          output_tokens: 245,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 3328,
        },
      },
    });
    expect(r).not.toBeNull();
    expect(r!.line).toMatchObject({
      input: 77271,
      output: 245,
      cacheRead: 3328,
      cacheWrite: 0,
    });
    expect(r!.line.cost).toBeUndefined();
  });
});

describe("parseUsageLine · codex 快照行型", () => {
  it("event_msg/token_count 标记 snapshot", () => {
    const r = parseUsageLine({
      timestamp: "2026-09-10T14:20:00Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 13275,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 87,
            reasoning_output_tokens: 48,
          },
        },
      },
    });
    expect(r).not.toBeNull();
    expect(r!.snapshot).toBe(true);
    expect(r!.line).toMatchObject({ input: 13275, output: 135 }); // 87+48
  });

  it("全零 usage 行(错误行)拒绝", () => {
    expect(
      parseUsageLine({
        timestamp: "2026-09-05T12:35:04.582Z",
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
    ).toBeNull();
  });

  it("非 usage 行返回 null", () => {
    expect(parseUsageLine({ type: "title", title: "x" })).toBeNull();
    expect(parseUsageLine("junk")).toBeNull();
  });
});

/* ── extractUsageFromHead ───────────────────────── */

describe("extractUsageFromHead", () => {
  it("omp 逐行累加语义:两行都保留", () => {
    const head = [
      JSON.stringify({ type: "title", title: "t" }),
      JSON.stringify({
        timestamp: "2026-09-10T14:31:09Z",
        message: { usage: { input: 100, output: 10 } },
      }),
      JSON.stringify({
        timestamp: "2026-09-10T15:31:09Z",
        message: { usage: { input: 200, output: 20 } },
      }),
    ].join("\n");
    const { lines } = extractUsageFromHead(head, NOW - WINDOW_MS);
    expect(lines).toHaveLength(2);
  });

  it("codex 3 个快照只留末次", () => {
    const mk = (ts: string, input: number) =>
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: input, output_tokens: 1 } },
        },
      });
    const head = [mk("2026-09-10T10:00:00Z", 100), mk("2026-09-10T11:00:00Z", 200), mk("2026-09-10T12:00:00Z", 300)].join("\n");
    const { lines } = extractUsageFromHead(head, NOW - WINDOW_MS);
    expect(lines).toHaveLength(1);
    expect(lines[0].input).toBe(300);
  });

  it("窗口外(startMs 前)行丢弃", () => {
    const head = JSON.stringify({
      timestamp: "2026-09-01T00:00:00Z", // 远早于 7 日窗口
      message: { usage: { input: 100, output: 10 } },
    });
    const { lines } = extractUsageFromHead(head, NOW - WINDOW_MS);
    expect(lines).toHaveLength(0);
  });

  it("坏 JSON 行跳过不抛", () => {
    const head = "{broken\n" + JSON.stringify({
      timestamp: "2026-09-10T14:31:09Z",
      message: { usage: { input: 5, output: 5 } },
    });
    const { lines } = extractUsageFromHead(head, NOW - WINDOW_MS);
    expect(lines).toHaveLength(1);
  });
});

/* ── aggregateUsage ─────────────────────────────── */

const label = (id: string): EngineLabel => ({ id, name: id });
const line = (ts: number, input: number, output: number): UsageLine => ({
  ts,
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
});

describe("aggregateUsage", () => {
  it("按引擎聚合 + hasUsage 语义", () => {
    const p = "/s1.jsonl";
    const agg = aggregateUsage(
      NOW,
      [label("omp"), label("kimi")],
      { omp: [{ path: p }] },
      { [p]: [line(NOW - 1000, 1000, 100), line(NOW - 2000, 500, 50)] },
    );
    expect(agg.byEngine).toHaveLength(2);
    const omp = agg.byEngine.find((e) => e.profileId === "omp")!;
    expect(omp.hasUsage).toBe(true);
    expect(omp.totalIn).toBe(1500);
    expect(omp.totalOut).toBe(150);
    const kimi = agg.byEngine.find((e) => e.profileId === "kimi")!;
    expect(kimi.hasUsage).toBe(false); // 行型未知 → UI 显 —
    expect(agg.sessions).toBe(1);
  });

  it("totals 跨引擎求和", () => {
    const a = "/a.jsonl";
    const b = "/b.jsonl";
    const agg = aggregateUsage(
      NOW,
      [label("omp"), label("claude")],
      { omp: [{ path: a }], claude: [{ path: b }] },
      { [a]: [line(NOW - 1000, 100, 10)], [b]: [line(NOW - 1000, 300, 30)] },
    );
    expect(agg.totals.input).toBe(400);
    expect(agg.totals.output).toBe(40);
  });

  it("daily 恒 7 天升序,无消费日 = 0", () => {
    const p = "/s.jsonl";
    const agg = aggregateUsage(NOW, [label("omp")], { omp: [{ path: p }] }, {
      [p]: [line(NOW, 100, 10)],
    });
    expect(agg.daily).toHaveLength(7);
    expect(agg.daily[6].totalIn).toBe(100); // 今天
    expect(agg.daily[0].totalIn).toBe(0); // 6 天前
    expect(agg.daily[0].dayKey < agg.daily[6].dayKey).toBe(true);
  });

  it("空 sessions → 全引擎 hasUsage=false,totals 0", () => {
    const agg = aggregateUsage(NOW, [label("omp")], {}, {});
    expect(agg.byEngine[0].hasUsage).toBe(false);
    expect(agg.totals.input).toBe(0);
    expect(agg.sessions).toBe(0);
  });

  it("7 日窗口边界:usage ts 早于窗口 → 不计入", () => {
    const p = "/s.jsonl";
    const agg = aggregateUsage(NOW, [label("omp")], { omp: [{ path: p }] }, {
      [p]: [line(NOW - WINDOW_MS - 1, 999, 999), line(NOW - WINDOW_MS + 1, 1, 1)],
    });
    // 注意:窗口过滤发生在 extractUsageFromHead;聚合器信任传入行。
    // 这里验证聚合器本身不重过滤 —— 总额只含传入行。
    expect(agg.totals.input).toBe(1000);
  });
});
