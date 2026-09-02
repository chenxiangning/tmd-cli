/**
 * cli-profiles 抽屉契约单测 —— proposal §初判表的守卫线:
 * 1. 各 CLI 声明的 send 项 ⊆ bare 合法清单(防手滑把带参命令标成 send,点击即误发 PTY)
 * 2. icon 名 ∈ drawerIcons 语义集(防抽屉渲染出无名兜底)
 * 3. 声明 token 的项必须显式 action(合成规则对自定义语法无意义)
 * 4. claude/codex 的 MCP 配置解析 happy path
 *
 * 直接 import 各插件导出的候选常量 —— 仅编译期数据引用(契约验证),
 * 运行时抽屉数据仍走 host 注册表,不构成插件间运行时依赖。
 */
import { describe, expect, it } from "vitest";
import { DRAWER_ICONS } from "./drawerIcons";
import { CLAUDE_COMMAND_SUGGESTIONS, extractClaudeMcpServers } from "../cli-claude";
import { OMP_COMMAND_SUGGESTIONS, OMP_SKILL_SUGGESTIONS } from "../cli-omp";
import { PI_COMMAND_SUGGESTIONS, PI_SKILL_SUGGESTIONS } from "../cli-pi";
import { CODEX_COMMAND_SUGGESTIONS, extractCodexMcpServers } from "../cli-codex";
import { GROK_COMMAND_SUGGESTIONS } from "../cli-grok";
import { KIMI_COMMAND_SUGGESTIONS } from "../cli-kimi";
import { QODER_COMMAND_SUGGESTIONS } from "../cli-shared/qoderSessions";
import type { CliSuggestion } from "@kernel/cli";

/** bare 合法清单(proposal §初判表;实测校准后在此回填) */
const BARE_LEGAL: Record<string, ReadonlySet<string>> = {
  claude: new Set(["help", "clear", "compact", "model", "usage", "resume"]),
  omp: new Set(["help", "clear", "model"]),
  pi: new Set(["help", "clear"]),
  codex: new Set(["model", "status", "diff", "init", "compact", "review", "permissions", "skills"]),
  grok: new Set(["model", "new", "load", "compact", "skills", "plugins"]),
  kimi: new Set(["help", "model", "sessions", "new", "plan", "compact", "usage"]),
  qoder: new Set(["simplify", "quest", "mcp-config", "run", "feedback"]),
  "qoder-cn": new Set(["simplify", "quest", "mcp-config", "run", "feedback"]),
};

const CANDIDATE_SETS: Record<string, CliSuggestion[]> = {
  claude: CLAUDE_COMMAND_SUGGESTIONS,
  omp: [...OMP_COMMAND_SUGGESTIONS, ...OMP_SKILL_SUGGESTIONS],
  pi: [...PI_COMMAND_SUGGESTIONS, ...PI_SKILL_SUGGESTIONS],
  codex: CODEX_COMMAND_SUGGESTIONS,
  grok: GROK_COMMAND_SUGGESTIONS,
  kimi: KIMI_COMMAND_SUGGESTIONS,
  qoder: QODER_COMMAND_SUGGESTIONS?.command ?? [],
  "qoder-cn": QODER_COMMAND_SUGGESTIONS?.command ?? [],
};

describe("cli-profiles 抽屉契约", () => {
  it("send 项 ⊆ bare 合法清单;token 项必须显式 action", () => {
    for (const [profileId, items] of Object.entries(CANDIDATE_SETS)) {
      const legal = BARE_LEGAL[profileId];
      expect(legal, `${profileId} 缺 bare 清单`).toBeDefined();
      for (const item of items) {
        if (item.action === "send") {
          expect(
            legal.has(item.value),
            `${profileId}/${item.value} 声明 send 但不在 bare 合法清单`,
          ).toBe(true);
        }
        if (item.token) {
          expect(item.action, `${profileId}/${item.value} 声明 token 但未显式 action`).toBeDefined();
        }
      }
    }
  });

  it("icon 名 ∈ drawerIcons 语义集", () => {
    for (const [profileId, items] of Object.entries(CANDIDATE_SETS)) {
      for (const item of items) {
        if (item.icon) {
          expect(
            DRAWER_ICONS[item.icon],
            `${profileId}/${item.value} 的 icon "${item.icon}" 未在 drawerIcons 登记`,
          ).toBeDefined();
        }
      }
    }
  });

  it("每个 CLI 至少声明一个 send 项(抽屉核心价值冒烟)", () => {
    for (const [profileId, items] of Object.entries(CANDIDATE_SETS)) {
      expect(
        items.some((i) => i.action === "send"),
        `${profileId} 无任何 send 项`,
      ).toBe(true);
    }
  });
});

describe("MCP 配置解析(纯函数)", () => {
  it("claude:全局 + 项目合并,项目覆盖同名,坏 JSON 返回空", () => {
    const json = JSON.stringify({
      mcpServers: { "web-reader": { command: "npx" }, dup: { command: "a" } },
      projects: { "/w": { mcpServers: { dup: { command: "b" } } } },
    });
    const items = extractClaudeMcpServers(json, "/w");
    expect(items.map((i) => i.value).sort()).toEqual(["dup", "web-reader"]);
    expect(items.find((i) => i.value === "dup")?.description).toContain("项目");
    expect(items.every((i) => i.action === "send" && i.token === "/mcp ")).toBe(true);
    expect(extractClaudeMcpServers("{broken", "/w")).toEqual([]);
  });

  it("codex:提取 [mcp_servers.<name>] 段头与 command;token 为 $mention", () => {
    const toml = [
      "[mcp_servers.node_repl]",
      'command = "/app/node_repl"',
      "[mcp_servers.node_repl.env]",
      "KEY = \"v\"",
      "[mcp_servers.computer-use]",
      'command = "sky"',
    ].join("\n");
    const items = extractCodexMcpServers(toml);
    expect(items.map((i) => i.value)).toEqual(["node_repl", "computer-use"]);
    expect(items[0].description).toContain("/app/node_repl");
    expect(items[0].token).toBe("$node_repl ");
    expect(items.every((i) => i.action === "insert")).toBe(true);
    expect(extractCodexMcpServers("")).toEqual([]);
  });
});
