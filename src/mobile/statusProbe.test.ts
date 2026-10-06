/**
 * statusProbe 纯函数与引擎映射测试(spec 2026-10-06-mobile-status-bar):
 * formatQuotaLine 三分支(余额/窗口/错误)+ 引擎映射支持/不支持判定。
 * IO 路径只钉 kimi(全局配置态,无会话也可读)一家验证映射接线。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaSnapshot } from "@kernel/quota";

const fsReadFile = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>());
vi.mock("@kernel/ipc", () => ({
  ipc: {
    configHomeDir: async () => "/home/x",
    fsReadFile,
    /* G3:kimi/grok 状态走 readStatusTailGated(fsReadTailChanged),与
       fsReadFile 同源 mock(首读 lastSize=null 恒 changed)。 */
    fsReadTailChanged: async (path: string) => ({ text: await fsReadFile(path), size: 0, changed: true }),
  },
}));

import {
  fetchMobileQuota,
  formatQuotaLine,
  hasMobileQuotaFetcher,
  quotaFetcherIds,
  readMobileSessionStatus,
  statusReaderIds,
} from "./statusProbe";

const snap = (over: Partial<QuotaSnapshot>): QuotaSnapshot => ({
  providerLabel: "X",
  title: "X 额度",
  usedLabel: "已使用",
  windows: [],
  ...over,
});

describe("formatQuotaLine(额度快照 → 行内短文本)", () => {
  it("余额型直出 balanceText", () => {
    expect(formatQuotaLine(snap({ balanceText: "¥12.50" }))).toBe("¥12.50");
  });

  it("窗口型:短标 + 已用百分比,「 · 」连接", () => {
    expect(
      formatQuotaLine(
        snap({
          windows: [
            { label: "5小时", displayPercent: 40 },
            { label: "7天", displayPercent: 80 },
          ],
        }),
      ),
    ).toBe("5h 用 40% · 7d 用 80%");
  });

  it("未知窗口标签原样透传", () => {
    expect(
      formatQuotaLine(snap({ windows: [{ label: "1小时", displayPercent: 10 }] })),
    ).toBe("1小时 用 10%");
  });

  it("error 覆盖正常显示 → null(调用方显「—」)", () => {
    expect(formatQuotaLine(snap({ error: "x", balanceText: "¥1" }))).toBeNull();
  });

  it("空窗无余额 → null", () => {
    expect(formatQuotaLine(snap({}))).toBeNull();
  });
});

describe("readMobileSessionStatus(引擎映射)", () => {
  /* 配置文件 fixture:path → 内容;缺省一律 ENOENT(beforeEach 先把实现装上,
   * 空实现窗口会让 ipc 调用拿到非 Promise)。 */
  const files = new Map<string, string>();
  beforeEach(() => {
    files.clear();
    fsReadFile.mockReset();
    fsReadFile.mockImplementation(async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    });
  });

  it("dsh(host RPC,桥不可及)与未知引擎 → null", async () => {
    await expect(readMobileSessionStatus("dsh", "/w", "sid")).resolves.toBeNull();
    await expect(readMobileSessionStatus("nope", "/w", "sid")).resolves.toBeNull();
  });

  it("会话态引擎无 cliSessionId → null(不触 IPC)", async () => {
    for (const id of ["omp", "pi", "claude", "codex", "grok", "opencode", "qoder", "qoder-cn"]) {
      await expect(readMobileSessionStatus(id, "/w")).resolves.toBeNull();
    }
    expect(fsReadFile).not.toHaveBeenCalled();
  });

  it("kimi 无会话也可读(全局 config.toml):模型 + 思考强度", async () => {
    files.set(
      "/home/x/.kimi-code/config.toml",
      'default_model = "kimi-code/k3"\n[thinking]\nenabled = true\neffort = "high"\n',
    );
    await expect(readMobileSessionStatus("kimi", "/w")).resolves.toEqual({
      model: "kimi-code/k3",
      thinkingLevel: "high",
    });
  });

  it("kimi 配置全缺 → null", async () => {
    await expect(readMobileSessionStatus("kimi", "/w")).resolves.toBeNull();
  });
});

describe("额度抓取器映射", () => {
  it("omp/pi/claude/codex/grok 有 fetcher;kimi/qoder/opencode/dsh 无", () => {
    for (const id of ["omp", "pi", "claude", "codex", "grok"]) {
      expect(hasMobileQuotaFetcher(id)).toBe(true);
    }
    for (const id of ["kimi", "qoder", "qoder-cn", "opencode", "dsh", "nope"]) {
      expect(hasMobileQuotaFetcher(id)).toBe(false);
    }
  });

  it("无 fetcher 引擎 fetchMobileQuota → null(不发请求)", async () => {
    await expect(fetchMobileQuota("kimi", {})).resolves.toBeNull();
    await expect(fetchMobileQuota("dsh", {})).resolves.toBeNull();
  });
});

describe("引擎映射表全集守护(engines.test 同款思路)", () => {
  it("STATUS_READERS/QUOTA_FETCHERS 与 ENGINES 差集恰为白名单(新引擎必显式归类)", async () => {
    const { ENGINES } = await import("./engines");
    const engineIds = new Set(ENGINES.map((e) => e.id));
    /* 可读全集 = STATUS_READERS ∪ {kimi}(kimi 走 readMobileSessionStatus
     * 特判,dsh host RPC 桥不可及入白名单)。新引擎落桌忘接线 → 差集断言红,
     * 提示三选一:接 reader / 入白名单(注明理由)。 */
    const readers = new Set(statusReaderIds());
    expect([...engineIds].filter((id) => !readers.has(id))).toEqual(["dsh"]);
    /* 额度白名单 = 桌面亦无 fetcher(kimi/qoder 双档/opencode)+ 桥不可及(dsh)。 */
    const fetchers = new Set(quotaFetcherIds());
    expect([...engineIds].filter((id) => !fetchers.has(id)).sort()).toEqual(
      ["dsh", "kimi", "opencode", "qoder", "qoder-cn"].sort(),
    );
  });
});
