/**
 * codexLocal.ts rollout 快照解析契约测试。
 * fixture 形状实证自 codex-cli 0.152.0 真实 rollout 文件。
 */
import { describe, expect, it } from "vitest";
import {
  codexPlanLabelWithSnapshot,
  parseCodexRolloutTail,
} from "./codexLocal";

function tokenCountLine(rateLimits: unknown, timestamp = "2026-09-01T14:45:12.599Z"): string {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: {} }, rate_limits: rateLimits },
  });
}

describe("parseCodexRolloutTail", () => {
  it("取尾部最新 token_count 的 rate_limits,window_minutes 决定标签", () => {
    const tail = [
      tokenCountLine({
        limit_id: "codex",
        plan_type: "prolite",
        primary: { used_percent: 65.0, window_minutes: 10080, resets_at: 1788748094 },
        secondary: null,
      }),
      tokenCountLine(
        {
          limit_id: "codex",
          plan_type: "prolite",
          primary: { used_percent: 70.0, window_minutes: 10080, resets_at: 1788748094 },
          secondary: { used_percent: 9.4, window_minutes: 300, resets_at: 1788740000 },
        },
        "2026-09-01T15:00:00.000Z",
      ),
    ].join("\n");
    const quota = parseCodexRolloutTail(tail);
    expect(quota).not.toBeNull();
    expect(quota!.planLabel).toBe("prolite");
    expect(quota!.snapshotAt).toBe(Date.parse("2026-09-01T15:00:00.000Z"));
    // 5h 在前;seconds → ms
    expect(quota!.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota!.windows[0].displayPercent).toBe(9);
    expect(quota!.windows[0].resetsAt).toBe(1788740000 * 1000);
    expect(quota!.windows[1].displayPercent).toBe(70);
  });

  it("槽位名不可信:secondary 带 300 分钟仍标为 5小时", () => {
    const quota = parseCodexRolloutTail(
      tokenCountLine({
        primary: { used_percent: 1, window_minutes: 10080 },
        secondary: { used_percent: 2, window_minutes: 300 },
      }),
    );
    expect(quota!.windows.map((w) => w.label)).toEqual(["5小时", "7天"]);
    expect(quota!.windows[0].displayPercent).toBe(2);
    expect(quota!.windows[1].displayPercent).toBe(1);
  });

  it("无 rate_limits 或全空窗口 → null(未对话/API key 模式)", () => {
    expect(parseCodexRolloutTail("")).toBeNull();
    expect(
      parseCodexRolloutTail(tokenCountLine({ primary: null, secondary: null })),
    ).toBeNull();
    expect(parseCodexRolloutTail('{"type":"response_item"}')).toBeNull();
  });

  it("尾部截断 JSON 行被跳过,继续向前找完整快照", () => {
    const good = tokenCountLine({
      plan_type: "pro",
      primary: { used_percent: 42, window_minutes: 300, resets_at: 1788740000 },
      secondary: null,
    });
    const tail = `${good}\n{"timestamp":"2026-09-01T16:00:00.000Z","type":"event_msg","payl`;
    const quota = parseCodexRolloutTail(tail);
    expect(quota!.windows[0].displayPercent).toBe(42);
    expect(quota!.planLabel).toBe("pro");
  });

  it("used_percent 越界钳制到 0-100", () => {
    const quota = parseCodexRolloutTail(
      tokenCountLine({ primary: { used_percent: 132.7, window_minutes: 300 }, secondary: null }),
    );
    expect(quota!.windows[0].displayPercent).toBe(100);
  });
});

describe("codexPlanLabelWithSnapshot", () => {
  it("plan + 快照时间拼接", () => {
    const label = codexPlanLabelWithSnapshot({
      windows: [],
      planLabel: "prolite",
      snapshotAt: Date.parse("2026-09-01T14:45:12.599Z"),
    });
    expect(label).toMatch(/^prolite · 快照 \d{2}:\d{2}$/);
  });

  it("无 plan 无快照 → undefined", () => {
    expect(codexPlanLabelWithSnapshot({ windows: [] })).toBeUndefined();
  });
});
