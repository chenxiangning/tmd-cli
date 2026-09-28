/**
 * ClawHub client 契约测试(quota_fetch 桩):列表/搜索/409 消歧/网络错误。
 * 形态实证:2026-09-28 clawhub.ai 实测(见 clawhubNormalize.test.ts 头注)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  quotaFetch: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    quotaFetch: mocks.quotaFetch,
  },
}));

import {
  ClawHubAmbiguousOwnerError,
  ClawHubHttpError,
  getClawHubSkillDetail,
  listClawHubSkills,
  resolveClawHubOwner,
  searchClawHubSkills,
} from "./clawhub";

function ok(body: unknown) {
  return { status: 200, body };
}

const LIST_ITEM = {
  slug: "pdf",
  displayName: "Pdf",
  summary: "PDF toolkit",
  topics: ["pdf"],
  stats: { downloads: 100, stars: 5, installs: 3 },
  updatedAt: 1789594554485,
  ownerHandle: "awspace",
  latestVersion: { version: "2.0.0" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listClawHubSkills", () => {
  it("列表 + cursor 透传;URL 带 sort/limit/nonSuspiciousOnly", async () => {
    mocks.quotaFetch.mockResolvedValue(ok({ items: [LIST_ITEM], nextCursor: "CUR" }));
    const result = await listClawHubSkills({ sort: "downloads" });
    expect(result.nextCursor).toBe("CUR");
    expect(result.items[0]).toMatchObject({ slug: "pdf", downloads: 100, latestVersion: "2.0.0" });
    const spec = mocks.quotaFetch.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(spec.url).toContain("sort=downloads");
    expect(spec.url).toContain("nonSuspiciousOnly=true");
    expect(spec.url).toContain("limit=24");
    expect(spec.headers.Accept).toBe("application/json");
  });

  it("4xx/5xx 原样报错(不重试)", async () => {
    mocks.quotaFetch.mockResolvedValue({ status: 503, body: "unavailable" });
    await expect(listClawHubSkills({ sort: "stars" })).rejects.toMatchObject({
      status: 503,
      body: "unavailable",
    });
    expect(mocks.quotaFetch).toHaveBeenCalledTimes(1);
  });

  it("网络错误(transport reject)原样抛出", async () => {
    mocks.quotaFetch.mockRejectedValue(new Error("proxy down"));
    await expect(listClawHubSkills({ sort: "newest" })).rejects.toThrow("proxy down");
  });
});

describe("searchClawHubSkills", () => {
  it("搜索端点与 results 归一化", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({ results: [{ slug: "pdf", displayName: "Pdf", downloads: 49728, ownerHandle: "awspace" }] }),
    );
    const cards = await searchClawHubSkills({ query: "pdf" });
    expect(cards[0]).toMatchObject({ slug: "pdf", downloads: 49728 });
    const spec = mocks.quotaFetch.mock.calls[0][0] as { url: string };
    expect(spec.url).toContain("/api/v1/search?");
    expect(spec.url).toContain("q=pdf");
  });
});

describe("getClawHubSkillDetail(409 消歧契约)", () => {
  it("重名 slug 缺 ownerHandle = 409 原样抛 ClawHubHttpError", async () => {
    mocks.quotaFetch.mockResolvedValue({
      status: 409,
      body: { code: "AMBIGUOUS_SKILL_SLUG", matches: [{ ownerHandle: "awspace" }, { ownerHandle: "paudyyin" }] },
    });
    const err = await getClawHubSkillDetail("pdf").catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubHttpError);
    expect((err as ClawHubHttpError).status).toBe(409);
  });

  it("详情归一化:license/changelog/ownerDisplayName 从嵌套对象取", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({
        skill: {
          slug: "pdf",
          displayName: "Pdf",
          ownerHandle: "awspace",
          latestVersion: { version: "2.0.0", license: "MIT", changelog: "fix" },
          owner: { displayName: "AWSpace" },
        },
      }),
    );
    const detail = await getClawHubSkillDetail("pdf", "awspace");
    expect(detail).toMatchObject({ license: "MIT", changelog: "fix", ownerDisplayName: "AWSpace" });
    const spec = mocks.quotaFetch.mock.calls[0][0] as { url: string };
    expect(spec.url).toContain("ownerHandle=awspace");
  });
});

describe("resolveClawHubOwner(消歧编排)", () => {
  it("卡带 ownerHandle 直接用,零请求", async () => {
    const source = { slug: "pdf", ownerHandle: "awspace", updatedAt: 1, latestVersion: "", downloads: 0 };
    const resolved = await resolveClawHubOwner(source as never);
    expect(resolved.ownerHandle).toBe("awspace");
    expect(mocks.quotaFetch).not.toHaveBeenCalled();
  });

  it("缺 owner → slug 搜索取候选收敛至唯一", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({
        results: [
          { slug: "pdf", ownerHandle: "awspace", updatedAt: 100, downloads: 10 },
          { slug: "pdf", ownerHandle: "paudyyin", updatedAt: 200, downloads: 20 },
        ],
      }),
    );
    /* 目标卡 updatedAt=200 匹配 paudyyin → 唯一命中。 */
    const resolved = await resolveClawHubOwner({
      slug: "pdf",
      ownerHandle: "",
      displayName: "Pdf",
      summary: "",
      topics: [],
      latestVersion: "",
      downloads: 20,
      stars: 0,
      installsCurrent: 0,
      updatedAt: 200,
      webUrl: "",
      downloadUrl: "",
    });
    expect(resolved.ownerHandle).toBe("paudyyin");
    expect(resolved.downloadUrl).toContain("ownerHandle=paudyyin");
  });

  it("仍歧义 = 报错列出候选,不盲选", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({
        results: [
          { slug: "pdf", ownerHandle: "awspace", updatedAt: 1 },
          { slug: "pdf", ownerHandle: "thcjp", updatedAt: 2 },
        ],
      }),
    );
    const err = await resolveClawHubOwner({
      slug: "pdf",
      ownerHandle: "",
      displayName: "Pdf",
      summary: "",
      topics: [],
      latestVersion: "",
      downloads: 0,
      stars: 0,
      installsCurrent: 0,
      updatedAt: 999,
      webUrl: "",
      downloadUrl: "",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ClawHubAmbiguousOwnerError);
    expect((err as ClawHubAmbiguousOwnerError).candidates.map((c) => c.ownerHandle)).toEqual([
      "awspace",
      "thcjp",
    ]);
  });
});
