/** sessionUsage 纯函数测试:汇总/文案/提取/轮种子/速度估算。
 * 速度语义 2026-10-03 重写(设计见 docs specs 2026-10-03-toks-pill-stability):
 * 增量行分子 = 本条 output,快照行分子 = 末两拍差,轮种子 + 180s cap + 近 5 对滑窗。 */
import { describe, expect, it } from "vitest";
import {
  extractUsageFromHead,
  formatUsage,
  lastUserTurnSeed,
  recentTokPerSec,
  summarizeUsage,
  type UsageLine,
} from "./sessionUsage";

describe("formatUsage", () => {
  it("k/M 缩写;无 cost 省略美元段", () => {
    expect(formatUsage({ input: 900, output: 100, cache: 0 })).toBe("≈ 1.0k tok");
    expect(formatUsage({ input: 2_000_000, output: 0, cache: 0 })).toBe("≈ 2.0M tok");
    expect(formatUsage({ input: 500, output: 0, cache: 0 })).toBe("≈ 500 tok");
    expect(formatUsage({ input: 100, output: 200, cache: 0, cost: 0.0405 })).toBe(
      "≈ 300 tok · $0.041",
    );
  });

  it("summarizeUsage:空行 null;cache 双字段归并", () => {
    expect(summarizeUsage([])).toBeNull();
    const s = summarizeUsage([
      { ts: 0, input: 10, output: 20, cacheRead: 5, cacheWrite: 3 },
      { ts: 1, input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.5 },
    ]);
    expect(s).toEqual({ input: 11, output: 22, cache: 8, cost: 0.5 });
  });
});

describe("extractUsageFromHead(头窗口提取,下沉后回归)", () => {
  it("omp 行 + codex 快照只留末次(默认 snapKeep=1)", () => {
    const head = [
      JSON.stringify({ timestamp: "2026-09-26T00:00:00Z", message: { usage: { input: 10, output: 5 } } }),
      JSON.stringify({ timestamp: "2026-09-26T01:00:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, output_tokens: 50 } } } }),
      JSON.stringify({ timestamp: "2026-09-26T02:00:00Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 200, output_tokens: 60 } } } }),
      "not json",
    ].join("\n");
    const lines = extractUsageFromHead(head, 0);
    expect(lines).toHaveLength(2); // omp 行 + codex 末次快照
    expect(lines[1]?.input).toBe(200);
  });

  it("snapKeep=2:快照留末两拍供速度差分", () => {
    const mk = (ts: string, out: number) =>
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1, output_tokens: out } } },
      });
    const lines = extractUsageFromHead(
      [mk("2026-10-03T00:00:00Z", 10), mk("2026-10-03T00:01:00Z", 20), mk("2026-10-03T00:02:00Z", 30)].join("\n"),
      0,
      2,
    );
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.output)).toEqual([20, 30]);
  });
});

describe("lastUserTurnSeed(轮种子 = 末次真实用户输入行)", () => {
  it("omp 字符串 content / claude list 纯文本 → 种子", () => {
    const head = [
      JSON.stringify({ timestamp: "2026-10-03T01:00:00Z", message: { role: "user", content: "继续" } }),
      JSON.stringify({ timestamp: "2026-10-03T01:01:00Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
    ].join("\n");
    expect(lastUserTurnSeed(head)).toBe(Date.parse("2026-10-03T01:01:00Z"));
  });

  it("工具回传行(list 带 tool_result)不作种子;assistant/usage 行不作种子", () => {
    const head = [
      JSON.stringify({ timestamp: "2026-10-03T01:00:00Z", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } }),
      JSON.stringify({ timestamp: "2026-10-03T01:01:00Z", message: { role: "assistant", usage: { input: 5, output: 5 } } }),
      "not json",
    ].join("\n");
    expect(lastUserTurnSeed(head)).toBeNull();
  });

  it("codex event_msg/user_message 行作种子", () => {
    const head = JSON.stringify({
      timestamp: "2026-10-03T02:00:00Z",
      type: "event_msg",
      payload: { type: "user_message", message: "hi" },
    });
    expect(lastUserTurnSeed(head)).toBe(Date.parse("2026-10-03T02:00:00Z"));
  });

  it("空文本 / 无用户行 → null", () => {
    expect(lastUserTurnSeed("")).toBeNull();
    expect(lastUserTurnSeed(JSON.stringify({ timestamp: "2026-10-03T00:00:00Z", message: { role: "assistant", usage: { input: 1, output: 1 } } }))).toBeNull();
  });
});

describe("recentTokPerSec(轮种子 + 滑窗响应均速)", () => {
  const line = (ts: number, output: number, snapshot = false): UsageLine => ({
    ts, input: 0, output, cacheRead: 0, cacheWrite: 0, snapshot,
  });

  it("增量行分子 = 本条 output(负差分不再吞,旧病回归)", () => {
    expect(recentTokPerSec([line(0, 800), line(10_000, 60)])).toBe(6);
    expect(recentTokPerSec([line(0, 10), line(10_000, 510)])).toBe(51);
  });

  it("快照行分子 = 末两拍差;前拍非快照(混列)弃", () => {
    expect(recentTokPerSec([line(0, 10, true), line(10_000, 510, true)])).toBe(50);
    expect(recentTokPerSec([line(0, 10), line(10_000, 510, true)])).toBeNull();
  });

  it("种子对:提交 → 首条完成即可显示", () => {
    expect(recentTokPerSec([line(10_000, 510)], 0)).toBe(51);
  });

  it("种子之前整轮剔除(跨轮污染归零)", () => {
    expect(recentTokPerSec([line(0, 10), line(5_000, 100), line(9_000, 300)], 6_000)).toBe(100);
  });

  it("种子对只配增量型;快照型等第二拍", () => {
    expect(recentTokPerSec([line(5_000, 100, true)], 2_000)).toBeNull();
    expect(recentTokPerSec([line(5_000, 100, true), line(15_000, 400, true)], 2_000)).toBe(30);
  });

  it("长停顿(Δts>180s)剔除 / 聚簇(<500ms)丢弃 / 零新增丢弃 / 空列表 null", () => {
    expect(recentTokPerSec([line(0, 10), line(200_000, 510)])).toBeNull();
    expect(recentTokPerSec([line(0, 10), line(400, 510)])).toBeNull();
    expect(recentTokPerSec([line(0, 10), line(10_000, 0)])).toBeNull();
    expect(recentTokPerSec([])).toBeNull();
  });

  it("单对速率超可信上限(300 tok/s,聚簇 artifact)弃", () => {
    expect(recentTokPerSec([line(0, 0), line(4_000, 2_000)])).toBeNull(); // 500 tok/s
    expect(recentTokPerSec([line(0, 0), line(4_000, 900)])).toBe(225); // 临界内保留
  });

  it("滑窗只取末 5 对:首对大值被挤出", () => {
    const lines = [
      line(0, 0),
      line(10_000, 1000),
      line(20_000, 100),
      line(30_000, 100),
      line(40_000, 100),
      line(50_000, 100),
      line(60_000, 100),
    ];
    expect(recentTokPerSec(lines)).toBe(10); // 5×100 tok ÷ 50s,不含首对 1000
  });
});
