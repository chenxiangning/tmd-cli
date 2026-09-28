/**
 * ClawHub 归一化与 owner 消歧契约测试(纯函数)。
 * 响应形态实证:2026-09-28 clawhub.ai 实测(列表项 flat + stats{} 双形态;
 * 搜索项 flat downloads、无 latestVersion/topics)。
 */
import { describe, expect, it } from "vitest";
import {
  buildClawHubDownloadUrl,
  buildClawHubWebUrl,
  normalizeClawHubCard,
  selectOwnerCandidate,
  type ClawHubCard,
} from "./clawhubNormalize";

function card(overrides: Partial<ClawHubCard>): ClawHubCard {
  return {
    slug: "pdf",
    displayName: "Pdf",
    summary: "PDF toolkit",
    topics: ["pdf", "docs"],
    latestVersion: "1.0.0",
    downloads: 100,
    stars: 10,
    installsCurrent: 5,
    updatedAt: 1700000000000,
    ownerHandle: "awspace",
    webUrl: "https://clawhub.ai/awspace/skills/pdf",
    downloadUrl: "https://clawhub.ai/api/v1/download?slug=pdf&tag=latest&ownerHandle=awspace",
    ...overrides,
  };
}

describe("normalizeClawHubCard", () => {
  it("列表形态(flat + stats{} 双落点)归一化,缺失值收敛空串/0", () => {
    const normalized = normalizeClawHubCard({
      slug: "self-improving-agent",
      displayName: "self-improving agent",
      summary: null,
      topics: ["a", "b", "c", "d", "e"],
      tags: { latest: "4.0.2" },
      stats: { downloads: 481583, stars: 3990, installs: 18454 },
      updatedAt: 1785999634404,
      ownerHandle: "pskoett",
      latestVersion: { version: "4.0.2" },
    });
    expect(normalized).toMatchObject({
      slug: "self-improving-agent",
      displayName: "self-improving agent",
      summary: "",
      topics: ["a", "b", "c"], // 展示前 3
      latestVersion: "4.0.2",
      downloads: 481583,
      stars: 3990,
      installsCurrent: 18454,
      ownerHandle: "pskoett",
    });
  });

  it("搜索形态(flat downloads、无 latestVersion/topics)归一化", () => {
    const normalized = normalizeClawHubCard({
      slug: "pdf",
      displayName: "Pdf",
      downloads: 49728,
      ownerHandle: "awspace",
      summary: "Comprehensive PDF toolkit",
      updatedAt: 1789594554485,
      version: null,
    });
    expect(normalized).toMatchObject({
      slug: "pdf",
      downloads: 49728,
      latestVersion: "",
      topics: [],
      installsCurrent: 0,
    });
  });

  it("slug 缺失 = 丢弃(null);webUrl/downloadUrl 兜底构造", () => {
    expect(normalizeClawHubCard({ displayName: "no slug" })).toBeNull();
    const normalized = normalizeClawHubCard({ slug: "x", ownerHandle: "o" });
    expect(normalized?.webUrl).toBe(buildClawHubWebUrl("o", "x"));
    expect(normalized?.downloadUrl).toBe("https://clawhub.ai/api/v1/download?slug=x&tag=latest&ownerHandle=o");
    expect(buildClawHubDownloadUrl("x")).toBe("https://clawhub.ai/api/v1/download?slug=x&tag=latest");
  });
});

describe("selectOwnerCandidate(owner 消歧收敛)", () => {
  const target = card({ ownerHandle: "" });
  const cand = (o: string, overrides: Partial<ClawHubCard> = {}) =>
    card({ ownerHandle: o, ...overrides });

  it("唯一同 slug 候选直接命中", () => {
    expect(selectOwnerCandidate(target, [cand("a"), cand("b", { slug: "other" })])?.ownerHandle).toBe("a");
  });
  it("updatedAt → latestVersion → downloads 逐级收敛", () => {
    /* 目标 updatedAt=111 命中全部;latestVersion=1.0.0 命中 b/c;downloads=2 只剩 c → 唯一。 */
    const target = card({ ownerHandle: "", updatedAt: 111, latestVersion: "1.0.0", downloads: 2 });
    const candidates = [
      cand("a", { updatedAt: 111, latestVersion: "1", downloads: 2 }),
      cand("b", { updatedAt: 111, latestVersion: "1.0.0", downloads: 1 }),
      cand("c", { updatedAt: 111, latestVersion: "1.0.0", downloads: 2 }),
      cand("d", { updatedAt: 222 }),
    ];
    expect(selectOwnerCandidate(target, candidates)?.ownerHandle).toBe("c");
  });

  it("逐级收敛后仍多个 = null(歧义,调用方报错列候选,不盲选)", () => {
    const candidates = [
      cand("a", { updatedAt: 1, latestVersion: "9", downloads: 7 }),
      cand("b", { updatedAt: 2, latestVersion: "8", downloads: 7 }),
    ];
    expect(selectOwnerCandidate(target, candidates)).toBeNull();
  });

  it("无同 slug 候选 = null", () => {
    expect(selectOwnerCandidate(target, [cand("a", { slug: "other" })])).toBeNull();
    expect(selectOwnerCandidate(target, [])).toBeNull();
  });
});
