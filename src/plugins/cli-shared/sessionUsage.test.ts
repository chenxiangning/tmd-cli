/** sessionUsage 纯函数补充测试:summarizeUsage 汇总与 formatUsage 文案。 */
import { describe, expect, it } from "vitest";
import { extractUsageFromHead, formatUsage, summarizeUsage } from "./sessionUsage";

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
  it("omp 行 + codex 快照只留末次", () => {
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
});
