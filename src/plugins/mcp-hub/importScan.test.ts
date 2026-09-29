/**
 * mcp-hub/importScan 契约测试 —— 路径集桩 + 内容双探测 + 同名首源优先。
 */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsReadFile: vi.fn(),
  configHomeDir: vi.fn(),
  platformKind: vi.fn(),
  quotaEnvValue: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadFile: mocks.fsReadFile,
    configHomeDir: mocks.configHomeDir,
    quotaEnvValue: mocks.quotaEnvValue,
  },
  platformKind: mocks.platformKind,
}));

import { mergeCandidates, scanExternalMcpSources, scanMcpFile } from "./importScan";

const HOME = "/home/u";
const files = new Map<string, string>();
mocks.fsReadFile.mockImplementation(async (p: string) => {
  const text = files.get(p);
  if (text !== undefined) return text;
  throw new Error("ENOENT");
});

function file(path: string, text: string) {
  files.set(path, text);
}

describe("scanExternalMcpSources", () => {
  it("固定路径集 + 同名多源保留首个(claude.json 优先)", async () => {
    mocks.configHomeDir.mockResolvedValue(HOME);
    mocks.platformKind.mockResolvedValue("darwin");
    file(
      `${HOME}/.claude.json`,
      JSON.stringify({ mcpServers: { zread: { type: "http", url: "https://a/mcp" }, shared: { command: "claude-one" } } }),
    );
    file(`${HOME}/.mcp.json`, JSON.stringify({ mcpServers: { other: { command: "y" }, shared: { command: "dot-mcp" } } }));
    const found = await scanExternalMcpSources();
    expect(found.map((c) => `${c.source}:${c.id}`)).toEqual([
      "claude.json:zread",
      "claude.json:shared",
      "~/.mcp.json:other",
    ]);
    expect(found.find((c) => c.id === "shared")?.entry).toEqual({ command: "claude-one" });
  });

  it("darwin 的 Claude Desktop 路径;全缺失 = 空表", async () => {
    mocks.configHomeDir.mockResolvedValue(HOME);
    mocks.platformKind.mockResolvedValue("darwin");
    files.clear(); // 全缺失场景:清空文件表,fsReadFile 一律 ENOENT
    expect(await scanExternalMcpSources()).toEqual([]);
    const called = mocks.fsReadFile.mock.calls.map((c) => c[0] as string);
    expect(called).toContain(`${HOME}/Library/Application Support/Claude/claude_desktop_config.json`);
    expect(called).toContain(`${HOME}/.codebuddy/mcp.json`);
  });
});

describe("scanMcpFile", () => {
  it("扩展名与内容双探测:无扩展名但含 [mcp_servers. 走 TOML;坏 JSON = 空", async () => {
    file("/x/config", '[mcp_servers.node_repl]\ncommand = "/opt/node"');
    const toml = await scanMcpFile("/x/config", "codex");
    expect(toml[0].entry).toEqual({ command: "/opt/node" });

    file("/x/broken.json", "{oops");
    expect(await scanMcpFile("/x/broken.json", "broken")).toEqual([]);
  });

  it("mergeCandidates:既有清单优先(同名保留首个)", () => {
    const existing = [{ source: "a", path: "/a", id: "x", entry: { command: "1" } }];
    const incoming = [
      { source: "b", path: "/b", id: "x", entry: { command: "2" } },
      { source: "b", path: "/b", id: "y", entry: { command: "3" } },
    ];
    const merged = mergeCandidates(existing, incoming);
    expect(merged.map((c) => c.id)).toEqual(["x", "y"]);
    expect(merged[0].entry).toEqual({ command: "1" });
  });
});
