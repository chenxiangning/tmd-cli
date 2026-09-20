/**
 * sessionDeleted 契约(会话删除意图层,tombstone 覆盖层):
 * sessionDeletedKey —— 三段身份 `${workspaceId}:${profileId}:${cliSessionId}`,
 *   与置顶/归档覆盖层同构。
 * isSessionDeleted —— 未标记 false;mark 后 true;落盘 entry 为单字段时间戳
 *   `{ deletedAt: number }`,写在 settings.sessionDeleted 表内。
 * markSessionDeleted —— 幂等(已在册刷新时间戳);容量 200 满额按 deletedAt
 *   逐出最旧条目;新写 key 受保护不被逐出;写经 updateSettings 单次落盘。
 *
 * settings 依赖面用内存桩(getSettingsState/updateSettings),不碰真实落盘。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSessionDeleted,
  markSessionDeleted,
  sessionDeletedKey,
} from "./sessionDeleted";

let mockSettings: {
  sessionDeleted: Record<string, { deletedAt: number }>;
};

vi.mock("./settings", () => ({
  getSettingsState: () => ({ settings: mockSettings }),
  updateSettings: (patch: Record<string, unknown>) => {
    mockSettings = { ...mockSettings, ...(patch as object) } as typeof mockSettings;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
  mockSettings = { sessionDeleted: {} };
});

describe("sessionDeletedKey", () => {
  it("三段身份以冒号拼接,与置顶 key 同构", () => {
    expect(sessionDeletedKey("ws1", "claude", "uuid-1")).toBe(
      "ws1:claude:uuid-1",
    );
  });
});

describe("isSessionDeleted / markSessionDeleted", () => {
  it("mark 前不在册;mark 后在册且落盘 entry 为 { deletedAt } 时间戳", () => {
    const key = sessionDeletedKey("ws1", "claude", "uuid-1");
    expect(isSessionDeleted(key)).toBe(false);
    markSessionDeleted(key);
    expect(isSessionDeleted(key)).toBe(true);
    expect(mockSettings.sessionDeleted[key]).toEqual({
      deletedAt: Date.parse("2026-09-19T00:00:00Z"),
    });
  });

  it("幂等:已在册重复 mark 刷新时间戳,不产生重复条目", () => {
    const key = sessionDeletedKey("ws1", "claude", "uuid-1");
    markSessionDeleted(key);
    const first = mockSettings.sessionDeleted[key].deletedAt;
    vi.setSystemTime(new Date("2026-09-19T00:05:00Z"));
    markSessionDeleted(key);
    expect(Object.keys(mockSettings.sessionDeleted)).toEqual([key]);
    expect(mockSettings.sessionDeleted[key].deletedAt).toBeGreaterThan(first);
  });

  it("满额逐出:第 2001 个写入逐出 deletedAt 最旧的条目,保留最新 2000 条", () => {
    for (let i = 0; i < 2000; i++) {
      vi.setSystemTime(new Date("2026-09-19T00:00:00Z").getTime() + i * 1_000);
      markSessionDeleted(sessionDeletedKey("ws1", "claude", `old-${i}`));
    }
    vi.setSystemTime(new Date("2026-09-19T00:05:00Z"));
    markSessionDeleted(sessionDeletedKey("ws1", "claude", "newest"));
    expect(Object.keys(mockSettings.sessionDeleted)).toHaveLength(2000);
    expect(isSessionDeleted(sessionDeletedKey("ws1", "claude", "old-0"))).toBe(
      false,
    );
    expect(isSessionDeleted(sessionDeletedKey("ws1", "claude", "old-1"))).toBe(
      true,
    );
    expect(isSessionDeleted(sessionDeletedKey("ws1", "claude", "newest"))).toBe(
      true,
    );
  });

  it("逐出保护:满额时新写 key 永不被逐出(逐出的总是历史最旧者)", () => {
    for (let i = 0; i < 2000; i++) {
      vi.setSystemTime(new Date("2026-09-19T00:00:00Z").getTime() + i * 1_000);
      markSessionDeleted(sessionDeletedKey("ws1", "claude", `old-${i}`));
    }
    // 与最旧条目同刻写入的新 key:即便时间上不占优,key 身份受保护
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z").getTime());
    markSessionDeleted(sessionDeletedKey("ws1", "claude", "just-now"));
    expect(isSessionDeleted(sessionDeletedKey("ws1", "claude", "just-now"))).toBe(
      true,
    );
    expect(Object.keys(mockSettings.sessionDeleted)).toHaveLength(2000);
  });
});
