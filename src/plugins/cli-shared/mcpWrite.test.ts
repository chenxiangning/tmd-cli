/**
 * cli-shared/mcpWrite 契约测试 —— 写回安全矩阵(JSON/TOML 双方言)。
 * 守护点:JSON 未知键保留/解析失败拒写/首建;TOML 注释逐行保留/段替换/
 * 子表段跨无关段删除/尾追加/env 内联表与子表双形状/引号转义/不可序列化拒写。
 * 样例取自磁盘实证(~/.codex/config.toml 的 [projects."..."] 交错布局、
 * ~/.claude.json 的 type 字段形状)。
 */
import { describe, expect, it } from "vitest";

import {
  parseJsonMcpServers,
  parseTomlMcpServers,
  removeJsonMcpServer,
  removeTomlMcpServer,
  serializeTomlServer,
  upsertTomlMcpServer,
  writeJsonMcpServers,
} from "./mcpWrite";

describe("mcpWrite · JSON 家", () => {
  const claudeLike = `{
  "numStartups": 41,
  "mcpServers": {
    "zread": { "type": "http", "url": "https://x/mcp", "headers": { "Authorization": "Bearer k" } },
    "zai": { "type": "stdio", "command": "npx", "args": ["-y", "@z_ai/mcp-server"], "env": {} }
  },
  "projects": { "/w": { "mcpServers": { "local": { "command": "x" } } } }
}`;

  it("upsert:替换同名整条,未知顶层键与嵌套 projects 原样保留", () => {
    const out = writeJsonMcpServers(claudeLike, {
      zai: { type: "stdio", command: "uvx", args: ["zai"] },
    });
    const data = JSON.parse(out);
    expect(data.numStartups).toBe(41);
    expect(data.projects["/w"].mcpServers.local).toEqual({ command: "x" });
    expect(data.mcpServers.zai).toEqual({ type: "stdio", command: "uvx", args: ["zai"] });
    expect(data.mcpServers.zread.url).toBe("https://x/mcp");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n")[1]).toBe('  "numStartups": 41,');
  });

  it("upsert:无 mcpServers 键 = 新增;空文本 = 首建", () => {
    expect(JSON.parse(writeJsonMcpServers('{"a":1}', { s: { command: "x" } })).mcpServers).toEqual({
      s: { command: "x" },
    });
    const first = writeJsonMcpServers("", { s: { command: "x" } });
    expect(JSON.parse(first)).toEqual({ mcpServers: { s: { command: "x" } } });
  });

  it("remove:删目标不碰其他;名不存在 = 幂等;mcpServers 键保留", () => {
    const removed = removeJsonMcpServer(claudeLike, "zread");
    const data = JSON.parse(removed);
    expect(Object.keys(data.mcpServers)).toEqual(["zai"]);
    expect(data.projects).toBeDefined();
    expect(removeJsonMcpServer(claudeLike, "nope")).toBe(removeJsonMcpServer(claudeLike, "nope"));
  });

  it("解析失败 = 抛错拒写(不静默清空);mcpServers 非对象同拒", () => {
    expect(() => writeJsonMcpServers("{oops", {})).toThrow();
    expect(() => removeJsonMcpServer('"mcpServers": [1]', "x")).toThrow();
    expect(() => writeJsonMcpServers('{"mcpServers": []}', {})).toThrow();
    expect(() => parseJsonMcpServers("{oops")).toThrow();
  });

  it("parse:无 mcpServers = 空表(待建语义)", () => {
    expect(parseJsonMcpServers("{}")).toEqual({});
    expect(parseJsonMcpServers('{"a":1}')).toEqual({});
  });
});

describe("mcpWrite · TOML 家", () => {
  /** codex 磁盘实证形状:主段与 env 子表段之间可夹 [projects."…"] 无关段。 */
  const codexLike = [
    "trust_level = \"trusted\"", // 顶层键(段外内容)
    "",
    "[mcp_servers.node_repl]",
    "args = []",
    "command = \"/opt/node_repl\"",
    "startup_timeout_sec = 120",
    "",
    "[projects.\"/Users/x\"]", // 无关段(含点斜杠引号名)
    "trust_level = \"trusted\"",
    "",
    "[mcp_servers.node_repl.env]",
    "NODE_REPL_NODE_PATH = \"/opt/node\"",
    "CODEX_HOME = \"/Users/x/.codex\"", // 行尾注释会被剥掉
    "",
    "[mcp_servers.other]",
    "command = \"run\"",
  ].join("\n");

  it("parse:主段 + 跨段子表合并为单条;无关段不混入", () => {
    const servers = parseTomlMcpServers(codexLike);
    expect(Object.keys(servers)).toEqual(["node_repl", "other"]);
    expect(servers.node_repl).toEqual({
      args: [],
      command: "/opt/node_repl",
      startup_timeout_sec: 120,
      env: { NODE_REPL_NODE_PATH: "/opt/node", CODEX_HOME: "/Users/x/.codex" },
    });
  });

  it("upsert:整段替换(主段 + 子表段),无关段与段外内容零变化", () => {
    const merged = {
      ...parseTomlMcpServers(codexLike).node_repl,
      command: "/new/path",
      env: { ONLY: "one" },
    };
    const out = upsertTomlMcpServer(codexLike, "node_repl", merged);
    const again = parseTomlMcpServers(out);
    expect(again.node_repl).toEqual({ ...merged, command: "/new/path", env: { ONLY: "one" } });
    expect(again.other).toEqual({ command: "run" });
    /* 段外字节零变化:顶层键与无关段逐行保留 */
    expect(out.startsWith('trust_level = "trusted"\n\n[mcp_servers.node_repl]')).toBe(true);
    expect(out).toContain('[projects."/Users/x"]\ntrust_level = "trusted"');
    /* 未知键(startup_timeout_sec)随整段替换保留 */
    expect(out).toContain("startup_timeout_sec = 120");
    /* env 内联表形状落地 */
    expect(out).toContain('env = { ONLY = "one" }');
  });

  it("upsert:新名 = 文件尾追加,不重排既有内容", () => {
    const out = upsertTomlMcpServer(codexLike, "fresh", { command: "npx", args: ["-y", "a"] });
    expect(out.endsWith('[mcp_servers.fresh]\ncommand = "npx"\nargs = ["-y", "a"]')).toBe(true);
    expect(out.startsWith(codexLike)).toBe(true);
  });

  it("remove:主段 + 子表段全删,子表后随空行吸收;名不存在 = 原样", () => {
    const out = removeTomlMcpServer(codexLike, "node_repl");
    expect(parseTomlMcpServers(out).node_repl).toBeUndefined();
    expect(parseTomlMcpServers(out).other).toEqual({ command: "run" });
    expect(out).toContain('[projects."/Users/x"]\ntrust_level = "trusted"');
    expect(out).not.toContain("NODE_REPL");
    expect(removeTomlMcpServer(codexLike, "nope")).toBe(codexLike);
  });

  it("序列化:引号/反斜杠/控制字符转义;非常规段名与键名加引号;扁平内联表", () => {
    const section = serializeTomlServer("we ird", {
      command: 'sa"y \\ ok',
      args: [],
      env: { "K-1": "v\"v" },
    });
    expect(section).toBe('[mcp_servers."we ird"]\ncommand = "sa\\"y \\\\ ok"\nargs = []\nenv = { K-1 = "v\\"v" }');
    expect(parseTomlMcpServers(section)["we ird"]).toEqual({
      command: 'sa"y \\ ok',
      args: [],
      env: { "K-1": 'v"v' },
    });
  });

  it("段内行尾注释保留在原文(替换场景丢段,追加场景不产注释)", () => {
    const withComment = '[mcp_servers.a]\ncommand = "x" # 老注释\nenv = { A = "1" }';
    const out = upsertTomlMcpServer(withComment, "a", { command: "y" });
    expect(out).toBe('[mcp_servers.a]\ncommand = "y"');
  });

  it("多行数组(跨行括号)可解析;不可序列化形状抛错拒写", () => {
    const multi = '[mcp_servers.m]\nargs = [\n  "a",\n  "b",\n]\ncommand = "x"';
    expect(parseTomlMcpServers(multi).m).toEqual({ args: ["a", "b"], command: "x" });
    expect(() => upsertTomlMcpServer("", "x", { bad: () => 1 })).toThrow();
  });

  it("布尔/数字/裸 token 值往返;单引号字面串", () => {
    const toml = [
      "[mcp_servers.b]",
      "command = 'lit # not comment'",
      "startup_timeout_sec = 120",
      "enabled = true",
      "when = 2024-11-05",
    ].join("\n");
    expect(parseTomlMcpServers(toml).b).toEqual({
      command: "lit # not comment",
      startup_timeout_sec: 120,
      enabled: true,
      when: "2024-11-05",
    });
  });
});
