/**
 * mcp-hub/registrySources 契约测试 —— quota_fetch 桩下的三源搜索 + 分页 +
 * 单源失败空态(抛错由 StoreView 落错误提示,不白屏)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ quotaFetch: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: { quotaFetch: mocks.quotaFetch } }));

import { resolveSmitheryDraft, searchRegistrySource } from "./registrySources";

function ok(body: unknown) {
  return { status: 200, body };
}

describe("searchRegistrySource", () => {
  it("official:limit/search/cursor 拼参,metadata 分页透传", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({
        servers: [{ server: { name: "a/b", remotes: [{ type: "streamable-http", url: "https://x" }] } }],
        metadata: { nextCursor: "c2", count: 41 },
      }),
    );
    const r = await searchRegistrySource({ source: "official", query: "brave", cursor: "c1" });
    const url = mocks.quotaFetch.mock.calls[0][0].url as string;
    expect(url.startsWith("https://registry.modelcontextprotocol.io/v0.1/servers?")).toBe(true);
    expect(url).toContain("search=brave");
    expect(url).toContain("cursor=c1");
    expect(r.items[0].name).toBe("a/b");
    expect(r.nextCursor).toBe("c2");
    expect(r.totalCount).toBe(41);
  });

  it("smithery:q/pageSize/page 拼参,pagination 翻页游标", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({ servers: [{ qualifiedName: "github" }], pagination: { currentPage: 1, totalPages: 3, totalCount: 143 } }),
    );
    const r = await searchRegistrySource({ source: "smithery", query: "git" });
    const url = mocks.quotaFetch.mock.calls[0][0].url as string;
    expect(url).toContain("q=git");
    expect(url).toContain("pageSize=24");
    expect(r.nextCursor).toBe("2");
    expect(r.totalCount).toBe(143);
  });

  it("glama:pageInfo.hasNextPage/endCursor 分页", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({ servers: [{ id: "g", name: "N" }], pageInfo: { hasNextPage: true, endCursor: "END" } }),
    );
    const r = await searchRegistrySource({ source: "glama" });
    expect(r.items[0].name).toBe("N");
    expect(r.nextCursor).toBe("END");
  });

  it("单源失败 = 抛错(调用方落空态);非 2xx 同抛", async () => {
    mocks.quotaFetch.mockResolvedValue({ status: 401, body: { error: { code: "unauthorized" } } });
    await expect(searchRegistrySource({ source: "glama" })).rejects.toThrow("HTTP 401");
    mocks.quotaFetch.mockRejectedValue(new Error("network down"));
    await expect(searchRegistrySource({ source: "official" })).rejects.toThrow("network down");
  });
});

describe("resolveSmitheryDraft", () => {
  it("smithery 卡拉详情补草稿;qualifiedName 路径段转义;已有草稿不再拉", async () => {
    mocks.quotaFetch.mockResolvedValue(
      ok({
        deploymentUrl: "https://x.run.tools",
        connections: [{ type: "http", deploymentUrl: "https://x.run.tools", configSchema: {} }],
      }),
    );
    const card = { source: "smithery" as const, id: "smithery:a/b", name: "a/b", description: "" };
    const detail = await resolveSmitheryDraft(card);
    const url = mocks.quotaFetch.mock.calls[0][0].url as string;
    expect(url).toBe("https://api.smithery.ai/servers/a/b"); // 段级转义:斜杠是合法分隔符
    expect(detail.installDraft?.server).toEqual({ url: "https://x.run.tools" });
    expect(await resolveSmitheryDraft(detail)).toBe(detail); // 已有草稿短路
  });
});
