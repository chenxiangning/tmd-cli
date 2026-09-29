/**
 * qoder MCP 发现契约测试 —— <dataDir>/shared_client/mcp.json 单源(双分发版经
 * variant 常量分流)、展示性 insert(无引用语法前置,禁向幕布写 wire)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  configHomeDir: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadFile: mocks.fsReadFile, configHomeDir: mocks.configHomeDir },
}));

import { listQoderMcpServers } from "./qoderMcp";

describe("listQoderMcpServers", () => {
  it("国际版走 .qoder、国内版走 .qoder-cn;insert 展示性条目", async () => {
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockImplementation(async (p: string) =>
      p === "/h/.qoder-cn/shared_client/mcp.json" ? '{"mcpServers":{"zread":{}}}' : "",
    );
    expect(await listQoderMcpServers(".qoder")).toBeNull();
    const items = await listQoderMcpServers(".qoder-cn");
    expect(items).toEqual([
      {
        value: "zread",
        description: "仅展示 · 无引用语法 · MCP · 全局",
        action: "insert",
        icon: "server",
        token: "zread ",
      },
    ]);
  });
});
