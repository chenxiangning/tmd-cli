/**
 * omp MCP 发现 IO 壳契约测试 —— 路径清单(用户双候选 + 项目双候选)、
 * 点击 send "/mcp "(面板命令)、home 不可得 = null。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  configHomeDir: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadFile: mocks.fsReadFile, configHomeDir: mocks.configHomeDir },
}));

import { listOmpMcpServers } from "./mcpServers";

describe("listOmpMcpServers", () => {
  it("主目录不可得 = null(不猜)", async () => {
    mocks.configHomeDir.mockRejectedValue(new Error("no home"));
    expect(await listOmpMcpServers("/w")).toBeNull();
  });

  it("四层候选全扫,全局 send 面板命令,坏 JSON 不拖垮其余层", async () => {
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockImplementation(async (p: string) => {
      if (p === "/h/.omp/agent/mcp.json") return '{"mcpServers":{"g":{}}';
      if (p === "/h/.omp/agent/.mcp.json") return '{"mcpServers":{"g":{}}}';
      if (p === "/w/.omp/mcp.json") return '{"mcpServers":{"p":{}}}';
      return "";
    });
    const items = await listOmpMcpServers("/w");
    expect(items?.map((s) => [s.value, s.action, s.token])).toEqual([
      ["g", "send", "/mcp "],
      ["p", "send", "/mcp "],
    ]);
    expect(mocks.fsReadFile.mock.calls.map((c) => c[0])).toEqual([
      "/h/.omp/agent/mcp.json",
      "/h/.omp/agent/.mcp.json",
      "/w/.omp/mcp.json",
      "/w/.omp/.mcp.json",
    ]);
  });
});
