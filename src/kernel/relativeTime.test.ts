/**
 * 相对时间契约测试。
 * 覆盖:空值、过去向各粒度(刚刚/分钟/小时/天/周/个月)、
 * 未来向各粒度(现在/秒/分钟/小时/天/周/个月)及语向切换。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeTime } from "./relativeTime";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatRelativeTime 空值", () => {
  it("0 返回空串", () => {
    expect(formatRelativeTime(0)).toBe("");
  });
});

describe("formatRelativeTime 过去向", () => {
  it("60 秒内 → 刚刚", () => {
    expect(formatRelativeTime(NOW - 1)).toBe("刚刚");
    expect(formatRelativeTime(NOW - 59_000)).toBe("刚刚");
  });

  it("分钟级 → N 分钟前", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000)).toBe("5 分钟前");
  });

  it("小时级 → N 小时前", () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000)).toBe("3 小时前");
  });

  it("天级 → N 天前", () => {
    expect(formatRelativeTime(NOW - 2 * 86_400_000)).toBe("2 天前");
  });

  it("周级 → N 周前", () => {
    expect(formatRelativeTime(NOW - 2 * 7 * 86_400_000)).toBe("2 周前");
  });

  it("月级 → N 个月前", () => {
    expect(formatRelativeTime(NOW - 60 * 86_400_000)).toBe("2 个月前");
  });
});

describe("formatRelativeTime 未来向", () => {
  it("同一秒 → 现在", () => {
    expect(formatRelativeTime(NOW)).toBe("现在");
  });

  it("秒级 → N 秒后", () => {
    expect(formatRelativeTime(NOW + 30_000)).toBe("30 秒后");
  });

  it("分钟级 → N 分钟后", () => {
    expect(formatRelativeTime(NOW + 10 * 60_000)).toBe("10 分钟后");
  });

  it("小时级 → N 小时后", () => {
    expect(formatRelativeTime(NOW + 5 * 3_600_000)).toBe("5 小时后");
  });

  it("天级 → N 天后", () => {
    expect(formatRelativeTime(NOW + 3 * 86_400_000)).toBe("3 天后");
  });

  it("周级 → N 周后", () => {
    expect(formatRelativeTime(NOW + 2 * 7 * 86_400_000)).toBe("2 周后");
  });

  it("月级 → N 个月后", () => {
    expect(formatRelativeTime(NOW + 90 * 86_400_000)).toBe("3 个月后");
  });
});
