/**
 * 引擎凭据盘点收口契约测试(credentials.ts;credentialsEngines 各引擎盘测由
 * credentialParse.test.ts 与桩外实现自担,此处只测公共收口面)。
 * 覆盖契约:
 * - toCredential 成功:VendorQuota 四字段透传,title 取 VENDOR_TITLE 映射
 * - toCredential 未收录 vendor:title 回退 providerId
 * - toCredential 查询失败:windows 空表 + note 收录说明(Error.message / 非 Error String 化)
 * - toCredential 首击失败:400ms 退避重试一次,重试成功返回重试结果
 * - toCredential 两连败:保留首次错误说明(不显示重试的错误)
 * - listEngineCredentials:六引擎 id 各自分发,未知 id 返回空数组
 * vendors / credentialsEngines 全程 vi.mock(前者含网络,后者碰真实 fs/sqlite IPC)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vendorsMock = vi.hoisted(() => ({
  fetchVendorQuota: vi.fn(),
  /* 只放一行映射:标题用例走 kimi,回退用例走真实表里也无标题的 unsupported */
  VENDOR_TITLE: { kimi: "KIMI 套餐额度" },
}));
vi.mock("../cli-shared/quota/vendors", () => vendorsMock);

const enginesMock = vi.hoisted(() => ({
  listOmpCredentials: vi.fn(),
  listPiCredentials: vi.fn(),
  listCodexCredentials: vi.fn(),
  listClaudeCredentials: vi.fn(),
  listGrokCredentials: vi.fn(),
  listOpencodeCredentials: vi.fn(),
}));
vi.mock("./credentialsEngines", () => enginesMock);

import { listEngineCredentials, toCredential } from "./credentials";

/** 六引擎分发断言共用:各引擎返回可区分的标记数组。 */
const marker = (tag: string) => [{ providerId: tag, title: tag, windows: [] }];
const ENGINE_TABLE = [
  ["omp", enginesMock.listOmpCredentials],
  ["pi", enginesMock.listPiCredentials],
  ["codex", enginesMock.listCodexCredentials],
  ["claude", enginesMock.listClaudeCredentials],
  ["grok", enginesMock.listGrokCredentials],
  ["opencode", enginesMock.listOpencodeCredentials],
] as const;

beforeEach(() => {
  vendorsMock.fetchVendorQuota.mockReset();
  for (const [, fn] of ENGINE_TABLE) fn.mockReset();
});

describe("toCredential", () => {
  it("成功:额度四字段透传,参数原样送达查询器,title 取映射", async () => {
    vendorsMock.fetchVendorQuota.mockResolvedValue({
      windows: [{ label: "5h", used: 1, total: 2 }],
      balanceText: "¥12.50",
      planLabel: "Pro",
    });
    const cred = { key: "sk-1" };
    const base = "https://api.example.com";
    const out = await toCredential("kimi-code", "kimi", cred, base);
    expect(out).toEqual({
      providerId: "kimi-code",
      title: "KIMI 套餐额度",
      windows: [{ label: "5h", used: 1, total: 2 }],
      balanceText: "¥12.50",
      planLabel: "Pro",
    });
    expect(vendorsMock.fetchVendorQuota).toHaveBeenCalledWith("kimi", cred, base);
  });

  it("未收录 vendor:title 回退 providerId,不裸抛", async () => {
    vendorsMock.fetchVendorQuota.mockResolvedValue({ windows: [] });
    const out = await toCredential("自建引擎", "unsupported", {});
    expect(out.title).toBe("自建引擎");
    expect(out.windows).toEqual([]);
  });

  it("查询失败:windows 空表,note 收 Error.message;非 Error 抛出物 String 化", async () => {
    vendorsMock.fetchVendorQuota.mockRejectedValueOnce(new Error("代理风控"));
    const withErr = await toCredential("p", "kimi", {});
    expect(withErr).toEqual({ providerId: "p", title: "KIMI 套餐额度", windows: [], note: "代理风控" });

    vendorsMock.fetchVendorQuota.mockRejectedValueOnce("瞬断字符串");
    const withRaw = await toCredential("p", "kimi", {});
    expect(withRaw.note).toBe("瞬断字符串");
  });

  it("首击失败:退避 400ms 重试一次,重试成功返回重试结果", async () => {
    vi.useFakeTimers();
    try {
      vendorsMock.fetchVendorQuota
        .mockRejectedValueOnce(new Error("首击失败"))
        .mockResolvedValueOnce({ windows: [{ label: "周", used: 0, total: 9 }], planLabel: "Max" });
      const pending = toCredential("p", "kimi", {});
      await vi.advanceTimersByTimeAsync(400);
      const out = await pending;
      expect(out.note).toBeUndefined();
      expect(out.planLabel).toBe("Max");
      expect(vendorsMock.fetchVendorQuota).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("两连败:保留首次错误说明", async () => {
    vi.useFakeTimers();
    try {
      vendorsMock.fetchVendorQuota
        .mockRejectedValueOnce(new Error("首击失败"))
        .mockRejectedValueOnce(new Error("重试失败"));
      const pending = toCredential("p", "kimi", {});
      await vi.advanceTimersByTimeAsync(400);
      const out = await pending;
      expect(out.windows).toEqual([]);
      expect(out.note).toBe("首击失败");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("listEngineCredentials", () => {
  it("六引擎 id 各自分发并透传结果", async () => {
    for (const [id, fn] of ENGINE_TABLE) {
      fn.mockResolvedValue(marker(id));
      await expect(listEngineCredentials(id)).resolves.toEqual(marker(id));
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it("未知引擎 id 返回空数组,不触碰任何引擎", async () => {
    await expect(listEngineCredentials("dsh")).resolves.toEqual([]);
    for (const [, fn] of ENGINE_TABLE) expect(fn).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
