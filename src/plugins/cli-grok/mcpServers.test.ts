/**
 * grok MCP 发现 IO 壳契约测试 —— TOML [mcp_servers.*] 双源(用户 config.toml +
 * 项目 .grok/config.toml)、点击 send "/mcps "(academy 实证,复数)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  configHomeDir: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: { fsReadFile: mocks.fsReadFile, configHomeDir: mocks.configHomeDir },
}));

import { listGrokMcpServers } from "./mcpServers";

describe("listGrokMcpServers", () => {
  it("用户 + 项目两源合并,项目同名覆盖来源;面板命令复数 /mcps", async () => {
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockImplementation(async (p: string) => {
      if (p === "/h/.grok/config.toml") return '[mcp_servers.web]\ncommand = "x"\n[models]\ndefault = "g"';
      if (p === "/w/.grok/config.toml") return "[mcp_servers.web]\n[mcp_servers.local]";
      return "";
    });
    const items = await listGrokMcpServers("/w");
    expect(items?.map((s) => [s.value, s.token, s.description])).toEqual([
      ["web", "/mcps ", "MCP · 项目"],
      ["local", "/mcps ", "MCP · 项目"],
    ]);
  });

  it("主目录不可得 = null;全缺 = null", async () => {
    mocks.configHomeDir.mockRejectedValue(new Error("no home"));
    expect(await listGrokMcpServers("/w")).toBeNull();
    mocks.configHomeDir.mockResolvedValue("/h");
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    expect(await listGrokMcpServers("/w")).toBeNull();
  });
});
