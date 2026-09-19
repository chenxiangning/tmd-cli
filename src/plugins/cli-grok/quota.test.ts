/**
 * grok 额度 provider 契约测试(fetchGrokQuota)。
 * 覆盖:凭据装配链 —— 读 ~/.grok/config.toml → 默认档案解析 →
 * base_url + api_key 齐全时按 baseUrl 识别供应商、以 {key} 形态查询、
 * 快照经 toQuotaSnapshot 以 ("grok", vendor, quota, "Grok 账号额度") 塑形;
 * 缺 api_key(官方 OAuth 登录态)或缺 base_url → 显式报不支持且不猜接口;
 * config.toml 读取失败 → IO 错误向上传播。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configHomeDir: vi.fn(),
  fsReadFile: vi.fn(),
  detectVendorByBaseUrl: vi.fn(),
  fetchVendorQuota: vi.fn(),
  toQuotaSnapshot: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: mocks.configHomeDir,
    fsReadFile: mocks.fsReadFile,
  },
}));

/* 供应商 HTTP 适配层整面打桩:本单元的契约是凭据装配与透传,不是 HTTP。 */
vi.mock("../cli-shared/quota/vendors", () => ({
  detectVendorByBaseUrl: mocks.detectVendorByBaseUrl,
  fetchVendorQuota: mocks.fetchVendorQuota,
  toQuotaSnapshot: mocks.toQuotaSnapshot,
}));

import { fetchGrokQuota } from "./quota";

const HOME = "/Users/x";
const CONFIG_PATH = `${HOME}/.grok/config.toml`;

/* 本机实证形态(2026-09,fufei.mossx.ai 中转通道)。 */
const TOML_FULL = [
  "[models]",
  'default = "grok"',
  "",
  '[model."grok"]',
  'model = "grok-4.6"',
  'base_url = "https://fufei.mossx.ai"',
  'api_key = "sk-relay-1"',
  "",
].join("\n");

const QUOTA = { windows: [{ used: 1, limit: 10 }], planLabel: "Pro" };
const SNAPSHOT = { provider: "grok", title: "中转站额度", windows: [] } as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configHomeDir.mockResolvedValue(HOME);
  mocks.fsReadFile.mockResolvedValue(TOML_FULL);
  mocks.detectVendorByBaseUrl.mockReturnValue("relay");
  mocks.fetchVendorQuota.mockResolvedValue(QUOTA);
  mocks.toQuotaSnapshot.mockReturnValue(SNAPSHOT);
});

describe("fetchGrokQuota", () => {
  it("双凭据齐全:识别 → 查询 → 快照塑形全链透传", async () => {
    expect(await fetchGrokQuota()).toBe(SNAPSHOT);
    expect(mocks.fsReadFile).toHaveBeenCalledWith(CONFIG_PATH);
    expect(mocks.detectVendorByBaseUrl).toHaveBeenCalledWith("https://fufei.mossx.ai");
    expect(mocks.fetchVendorQuota).toHaveBeenCalledWith(
      "relay",
      { key: "sk-relay-1" },
      "https://fufei.mossx.ai",
    );
    expect(mocks.toQuotaSnapshot).toHaveBeenCalledWith(
      "grok",
      "relay",
      QUOTA,
      "Grok 账号额度",
    );
  });

  it("缺 api_key(官方 OAuth 登录态)→ 显式报不支持,不猜接口", async () => {
    mocks.fsReadFile.mockResolvedValue('[model."grok"]\nbase_url = "https://x.ai"\n');
    await expect(fetchGrokQuota()).rejects.toThrow(/未找到 grok 凭据/);
    expect(mocks.detectVendorByBaseUrl).not.toHaveBeenCalled();
    expect(mocks.fetchVendorQuota).not.toHaveBeenCalled();
  });

  it("缺 base_url(仅 key)→ 同样显式报不支持", async () => {
    mocks.fsReadFile.mockResolvedValue('[model."grok"]\napi_key = "sk-1"\n');
    await expect(fetchGrokQuota()).rejects.toThrow(/未找到 grok 凭据/);
    expect(mocks.fetchVendorQuota).not.toHaveBeenCalled();
  });

  it("config.toml 读取失败 → IO 错误原样向上传播", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("enoent: config.toml"));
    await expect(fetchGrokQuota()).rejects.toThrow("enoent: config.toml");
  });
});
