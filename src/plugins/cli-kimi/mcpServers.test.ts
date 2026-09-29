/**
 * kimi MCP 发现 IO 壳契约测试 —— 新居双源(用户 + 项目)、旧居不扫、
 * 点击 send "/mcp "(dist 实证状态面板)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  configHomeDir: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadFile: mocks.fsReadFile, configHomeDir: mocks.configHomeDir },
}));

import { listKimiMcpServers } from "./mcpServers";

describe("listKimiMcpServers", () => {
  it("主目录不可得 = null;只扫新居(旧居 ~/.kimi 无服务器存储)", async () => {
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockImplementation(async (p: string) =>
      p === "/h/.kimi-code/mcp.json" ? '{"mcpServers":{"zread":{}}}' : "",
    );
    const items = await listKimiMcpServers("/w");
    expect(items).toEqual([
      {
        value: "zread",
        description: "MCP · 全局",
        action: "send",
        icon: "server",
        token: "/mcp ",
      },
    ]);
    expect(mocks.fsReadFile.mock.calls.map((c) => c[0])).toEqual([
      "/h/.kimi-code/mcp.json",
      "/w/.kimi-code/mcp.json",
    ]);
  });

  it("全部缺失 = null(不猜)", async () => {
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockResolvedValue("");
    expect(await listKimiMcpServers("/w")).toBeNull();
  });
});
