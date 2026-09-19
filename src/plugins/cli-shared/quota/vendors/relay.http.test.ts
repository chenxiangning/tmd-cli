/**
 * vendors/http.ts 公共小工具契约测试(与 relay.test.ts 同族;主文件超 300 行上限,
 * 依仓例拆 .http 后缀文件)。
 *
 * 覆盖契约:
 * - asNum:有限数字/数字串 → number;NaN/Infinity/非数字串/其他类型 → undefined
 * - extractResetTime:毫秒原样、秒×1000、过小数字视为非时间、ISO 串 Date.parse、不可解析 undefined
 * - twoDecimals:保留两位;非有限数回落 "0.00"
 * - window:百分比钳 [0,100] 并取整;resetsAt 仅真值携带(0 视为缺失)
 * - httpJson:GET 透传 quotaFetch;2xx 透传 body;401/403 → 鉴权失败;
 *   其余非 2xx → HTTP 状态 + body JSON 截断 200 字;body 缺失时不带提示
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: { quotaFetch: vi.fn() },
}));

import { ipc } from "@kernel/ipc";
import { asNum, extractResetTime, httpJson, twoDecimals, window as quotaWindow } from "./http";

const quotaFetch = vi.mocked(ipc.quotaFetch);

beforeEach(() => {
  quotaFetch.mockReset();
});

describe("纯工具 asNum / extractResetTime / twoDecimals / window", () => {
  it("asNum 数字与数字串放行,其余归 undefined", () => {
    expect(asNum(12.5)).toBe(12.5);
    expect(asNum(" 8 ")).toBe(8);
    expect(asNum(Number.NaN)).toBeUndefined();
    expect(asNum(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(asNum("abc")).toBeUndefined();
    expect(asNum(null)).toBeUndefined();
    expect(asNum({})).toBeUndefined();
  });

  it("extractResetTime 时间语义分界:毫秒/秒/过小数/ISO/垃圾串", () => {
    expect(extractResetTime(1_788_740_000_000)).toBe(1_788_740_000_000);
    expect(extractResetTime(1_788_740_000)).toBe(1_788_740_000_000);
    expect(extractResetTime(500)).toBeUndefined();
    expect(extractResetTime("2026-09-20T00:00:00Z")).toBe(Date.parse("2026-09-20T00:00:00Z"));
    expect(extractResetTime("n/a")).toBeUndefined();
  });

  it("twoDecimals 保留两位,非有限数回落 0.00", () => {
    expect(twoDecimals(12.3)).toBe("12.30");
    expect(twoDecimals(Number.NaN)).toBe("0.00");
  });

  it("window 百分比钳 [0,100] 取整;resetsAt 真值才携带", () => {
    expect(quotaWindow("a", -5)).toEqual({ label: "a", displayPercent: 0 });
    expect(quotaWindow("b", 150.7)).toEqual({ label: "b", displayPercent: 100 });
    expect(quotaWindow("c", 49.6)).toEqual({ label: "c", displayPercent: 50 });
    expect(quotaWindow("d", 10, 0)).toEqual({ label: "d", displayPercent: 10 });
    expect(quotaWindow("e", 10, 123)).toEqual({ label: "e", displayPercent: 10, resetsAt: 123 });
  });
});

describe("httpJson 统一报错封装", () => {
  it("以 GET 透传给 quotaFetch,2xx 返回 body", async () => {
    quotaFetch.mockResolvedValue({ status: 200, body: { hello: 1 } });
    await expect(httpJson({ url: "https://x", headers: { a: "b" } })).resolves.toEqual({
      hello: 1,
    });
    expect(quotaFetch).toHaveBeenCalledWith({ url: "https://x", method: "GET", headers: { a: "b" } });
  });

  it("401/403 → 鉴权失败 (HTTP status)", async () => {
    quotaFetch.mockResolvedValue({ status: 401, body: null });
    await expect(httpJson({ url: "https://x", headers: {} })).rejects.toThrow("鉴权失败 (HTTP 401)");
    quotaFetch.mockResolvedValue({ status: 403, body: null });
    await expect(httpJson({ url: "https://x", headers: {} })).rejects.toThrow("鉴权失败 (HTTP 403)");
  });

  it("其余非 2xx → HTTP 状态 + body JSON 截断 200 字", async () => {
    const big = { m: "x".repeat(300) };
    quotaFetch.mockResolvedValue({ status: 500, body: big });
    await expect(httpJson({ url: "https://x", headers: {} })).rejects.toThrow(
      `HTTP 500: ${JSON.stringify(big).slice(0, 200)}`,
    );
    quotaFetch.mockResolvedValue({ status: 199, body: null });
    await expect(httpJson({ url: "https://x", headers: {} })).rejects.toThrow("HTTP 199:");
  });

  it("body 缺失时仅报状态码不带提示", async () => {
    quotaFetch.mockResolvedValue({ status: 502, body: undefined });
    await expect(httpJson({ url: "https://x", headers: {} })).rejects.toThrow(/^HTTP 502$/);
  });
});
