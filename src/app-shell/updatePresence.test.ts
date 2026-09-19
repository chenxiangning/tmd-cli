/**
 * updatePresence 单测 —— 守住四个可观察契约:
 * 1. parsePresenceCache:损坏/形状不对一律按无缓存,绝不抛错;
 * 2. isCheckDue:恰到期即 true(≥ 间隔);
 * 3. maybeCheckForUpdate 节流:未到期不发请求;
 * 4. 记账纪律:成功才回写缓存与快照,失败保留旧账(下个周期重试)。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const checkLatestRelease = vi.hoisted(
  () =>
    vi.fn<
      () => Promise<{
        release: { version: string; name: string; htmlUrl: string; publishedAt: string; notes: string } | null;
        error: string | null;
      }>
    >(),
);
vi.mock("./updateCheck", () => ({ checkLatestRelease }));

import {
  UPDATE_CHECK_INTERVAL_MS,
  getUpdatePresence,
  isCheckDue,
  maybeCheckForUpdate,
  parsePresenceCache,
  recordPresenceCheck,
} from "./updatePresence";

/** localStorage 替身:默认空仓库,测试手动放账本。 */
const ls = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
});

const release = (version: string) => ({ version, name: `tmd-cli v${version}`, htmlUrl: "https://x", publishedAt: "", notes: "" });
const cacheKey = "shell.updatePresence.v1";

beforeEach(() => {
  checkLatestRelease.mockReset();
  /* 快照复位;recordPresenceCheck 会顺带写账,一并清掉。 */
  recordPresenceCheck(null);
  ls.clear();
});

describe("parsePresenceCache", () => {
  it.each([
    ["null 原文", null],
    ["坏 JSON", "{oops"],
    ["裸数字", "42"],
    ["缺 checkedAt", '{"release":null}'],
    ["checkedAt 非数", '{"checkedAt":"x"}'],
  ])("%s → null", (_label, raw) => {
    expect(parsePresenceCache(raw as string | null)).toBeNull();
  });

  it("合法形状原样读出;缺 release 按 null", () => {
    expect(parsePresenceCache('{"checkedAt":100,"release":{"version":"0.2.0"}}')).toMatchObject({
      checkedAt: 100,
      release: { version: "0.2.0" },
    });
    expect(parsePresenceCache('{"checkedAt":100}')).toEqual({ checkedAt: 100, release: null });
  });
});

describe("isCheckDue", () => {
  it("间隔内 false;恰到期与超期 true", () => {
    expect(isCheckDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(isCheckDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS)).toBe(true);
    expect(isCheckDue(1000, 1000 + UPDATE_CHECK_INTERVAL_MS * 5)).toBe(true);
  });
});

describe("maybeCheckForUpdate", () => {
  it("无缓存 → 检查;成功回写缓存与快照", async () => {
    checkLatestRelease.mockResolvedValue({ release: release("0.3.0"), error: null });
    await maybeCheckForUpdate(1000);
    expect(checkLatestRelease).toHaveBeenCalledTimes(1);
    expect(JSON.parse(ls.get(cacheKey)!)).toMatchObject({ checkedAt: 1000, release: { version: "0.3.0" } });
    expect(getUpdatePresence().latest?.version).toBe("0.3.0");
  });

  it("账本新鲜 → 跳过请求", async () => {
    recordPresenceCheck(release("0.3.0"), 1000);
    await maybeCheckForUpdate(1000 + UPDATE_CHECK_INTERVAL_MS - 1);
    expect(checkLatestRelease).not.toHaveBeenCalled();
  });

  it("账本过期 + 失败 → 保留旧账,快照不动", async () => {
    recordPresenceCheck(release("0.3.0"), 1000);
    checkLatestRelease.mockResolvedValue({ release: null, error: "网络请求失败" });
    await maybeCheckForUpdate(1000 + UPDATE_CHECK_INTERVAL_MS);
    expect(JSON.parse(ls.get(cacheKey)!).checkedAt).toBe(1000);
    expect(getUpdatePresence().latest?.version).toBe("0.3.0");
  });

  it("账本过期 + 成功 → 换新账,快照跟进", async () => {
    localStorage.setItem(cacheKey, JSON.stringify({ checkedAt: 1000, release: release("0.3.0") }));
    checkLatestRelease.mockResolvedValue({ release: release("0.4.0"), error: null });
    await maybeCheckForUpdate(1000 + UPDATE_CHECK_INTERVAL_MS);
    expect(JSON.parse(ls.get(cacheKey)!)).toMatchObject({ checkedAt: 1000 + UPDATE_CHECK_INTERVAL_MS, release: { version: "0.4.0" } });
    expect(getUpdatePresence().latest?.version).toBe("0.4.0");
  });
});
