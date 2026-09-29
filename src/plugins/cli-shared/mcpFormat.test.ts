/**
 * cli-shared/mcpFormat 契约测试 —— 两家方言提取 + 条目合成(层覆盖/缺失语义)。
 * 守护点:codex/grok 依赖的 TOML 段头规则(含带引号段名、点分子键排除)、
 * omp/kimi/qoder 依赖的 JSON mcpServers 键提取、全部缺失 = null(无此区)。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fsReadFile: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: { fsReadFile: mocks.fsReadFile } }));

import {
  extractJsonMcpServerNames,
  extractTomlMcpServers,
  listMcpServersFromSources,
} from "./mcpFormat";

describe("extractTomlMcpServers", () => {
  it("提取段名与 command 键;点分子键不算服务器", () => {
    const toml = [
      '[mcp_servers.zread]',
      'command = "node"',
      'args = ["a.js"]',
      "[mcp_servers.tools.search]",
      'url = "https://x"',
      '[mcp_servers."quoted name"]',
      'command = "run"',
    ].join("\n");
    expect(extractTomlMcpServers(toml)).toEqual([
      { name: "zread", command: "node" },
      { name: "quoted name", command: "run" },
    ]);
  });

  it("空文本/无段 = 空数组;同名段去重保首现", () => {
    expect(extractTomlMcpServers("")).toEqual([]);
    expect(extractTomlMcpServers('[models]\ndefault = "x"')).toEqual([]);
    expect(extractTomlMcpServers('[mcp_servers.a]\ncommand = "1"\n[mcp_servers.a]\ncommand = "2"')).toEqual([
      { name: "a", command: "1" },
    ]);
  });

  it("段名带空格与行尾注释形态不漏显(评审 P2-5)", () => {
    expect(extractTomlMcpServers('[ mcp_servers.x1 ] # note\n[mcp_servers.x2]\n\t')).toEqual([
      { name: "x1" },
      { name: "x2" },
    ]);
  });
});

describe("extractJsonMcpServerNames", () => {
  it("提取 mcpServers 键;坏 JSON/无键/数组值 = 空", () => {
    expect(extractJsonMcpServerNames('{"mcpServers":{"a":{},"b":{"type":"http"}}}')).toEqual([
      "a",
      "b",
    ]);
    expect(extractJsonMcpServerNames("{broken")).toEqual([]);
    expect(extractJsonMcpServerNames("{}")).toEqual([]);
    expect(extractJsonMcpServerNames('{"mcpServers":[]}')).toEqual([]);
    expect(extractJsonMcpServerNames('{"mcpServers":{"":"x"}}')).toEqual([]);
  });
});

describe("listMcpServersFromSources", () => {
  it("全部文件缺失 = null(无此区数据);失败按缺失处理", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    expect(
      await listMcpServersFromSources(
        [{ path: "/a/mcp.json", source: "全局" }],
        { action: "send", token: "/mcp " },
      ),
    ).toBeNull();
  });

  it("项目层同名覆盖来源徽标、位置保持首现层;send 与 insert 两种点击语义", async () => {
    mocks.fsReadFile.mockImplementation(async (p: string) =>
      p === "/home/.x/mcp.json"
        ? '{"mcpServers":{"g":{},"shared":{}}}'
        : p === "/proj/.x/mcp.json"
          ? '{"mcpServers":{"shared":{"type":"http"},"p":{}}}'
          : "",
    );
    const sent = await listMcpServersFromSources(
      [
        { path: "/home/.x/mcp.json", source: "全局" },
        { path: "/proj/.x/mcp.json", source: "项目" },
      ],
      { action: "send", token: "/mcp " },
    );
    expect(sent?.map((s) => [s.value, s.action, s.token, s.description])).toEqual([
      ["g", "send", "/mcp ", "MCP · 全局"],
      ["shared", "send", "/mcp ", "MCP · 项目"],
      ["p", "send", "/mcp ", "MCP · 项目"],
    ]);
    const shown = await listMcpServersFromSources(
      [{ path: "/home/.x/mcp.json", source: "全局" }],
      { action: "insert", descriptionPrefix: "仅展示 · 无引用语法" },
    );
    expect(shown?.map((s) => [s.action, s.token, s.description])).toEqual([
      ["insert", "g ", "仅展示 · 无引用语法 · MCP · 全局"],
      ["insert", "shared ", "仅展示 · 无引用语法 · MCP · 全局"],
    ]);
  });

  it("toml 源走段提取方言", async () => {
    mocks.fsReadFile.mockResolvedValue('[mcp_servers.t]\ncommand = "run"');
    const items = await listMcpServersFromSources(
      [{ path: "/home/.grok/config.toml", source: "全局", format: "toml" }],
      { action: "send", token: "/mcps " },
    );
    expect(items).toEqual([
      { value: "t", description: "MCP · 全局", action: "send", icon: "server", token: "/mcps " },
    ]);
  });
});
