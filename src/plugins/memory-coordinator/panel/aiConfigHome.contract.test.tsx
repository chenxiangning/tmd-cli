/**
 * E-01 AI 配置统一落地首页契约 —— aiConfigNav 纯逻辑 + AiConfigHome 渲染:
 * - 五类直达入口(引擎/Skills/MCP/Magic Context/智能体·提示词)+ 记忆与规则双按钮
 *   + 会话预设说明卡;
 * - 直达调用面:设置 section/tab 深链、hubTab 幂等 open、控制台 tab;
 * - 目标插件停用 → 对应卡 disabled 并给原因,未停用卡仍可用,无死按钮。
 * node 环境:无 jsdom,渲染走 react-dom/server。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const disabled = vi.hoisted(() => [] as string[]);
const nav = vi.hoisted(() => ({
  openSettingsPanel: vi.fn(),
  openSkillHubTab: vi.fn(),
  openMcpHubTab: vi.fn(),
  openConsoleTab: vi.fn(),
}));

vi.mock("@kernel/settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@kernel/settings")>();
  return {
    ...mod,
    useSettingsState: () => ({ settings: { disabledPlugins: [...disabled] }, loaded: true }),
    openSettingsPanel: nav.openSettingsPanel,
  };
});
vi.mock("@kernel/i18n", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@kernel/i18n")>();
  return { ...mod, t: (k: string) => k, registerMessages: () => {} };
});
vi.mock("@plugins/skill-hub/hubTab", () => ({ openSkillHubTab: nav.openSkillHubTab }));
vi.mock("@plugins/mcp-hub/hubTab", () => ({ openMcpHubTab: nav.openMcpHubTab }));
vi.mock("../console/consoleTab", () => ({ openConsoleTab: nav.openConsoleTab, toggleConsoleTab: vi.fn() }));

import { buildAiConfigNav } from "./aiConfigNav";
import { AiConfigHome } from "./AiConfigHome";

const host = { onShowFiles: vi.fn(), onShowLint: vi.fn() };

beforeEach(() => {
  disabled.length = 0;
  vi.clearAllMocks();
});

describe("E-01 buildAiConfigNav · 直达调用面", () => {
  it("引擎/智能体走设置深链(cli-config·engines / assets·agents),Skills/MCP/控制台走各自 open", () => {
    const n = buildAiConfigNav([], host);
    const byId = Object.fromEntries(n.entries.map((e) => [e.id, e]));
    expect(n.entries.map((e) => e.id)).toEqual(["engines", "skills", "mcp", "magic-context", "assets"]);

    byId.engines.onClick();
    expect(nav.openSettingsPanel).toHaveBeenCalledWith({ section: "cli-config", tab: "engines" });
    byId.assets.onClick();
    expect(nav.openSettingsPanel).toHaveBeenCalledWith({ section: "assets", tab: "agents" });
    byId.skills.onClick();
    expect(nav.openSkillHubTab).toHaveBeenCalledTimes(1);
    byId.mcp.onClick();
    expect(nav.openMcpHubTab).toHaveBeenCalledTimes(1);
    byId["magic-context"].onClick();
    expect(nav.openConsoleTab).toHaveBeenCalledTimes(1);
    /* 记忆与规则 = 本面板视图切换。 */
    n.onShowFiles();
    n.onShowLint();
    expect(host.onShowFiles).toHaveBeenCalledTimes(1);
    expect(host.onShowLint).toHaveBeenCalledTimes(1);
  });

  it("目标插件停用:仅对应卡 disabled,宿主自身(Magic Context/记忆与规则/预设)不禁用", () => {
    const n = buildAiConfigNav(["skill-hub", "assets"], host);
    const byId = Object.fromEntries(n.entries.map((e) => [e.id, e]));
    expect(byId.skills.disabled).toBe(true);
    expect(byId.assets.disabled).toBe(true);
    expect(byId.engines.disabled).toBe(false);
    expect(byId.mcp.disabled).toBe(false);
    expect(byId["magic-context"].disabled).toBeFalsy();
    expect(n.offReason).toContain("插件市场");
  });
});

describe("E-01 AiConfigHome · 渲染", () => {
  it("五卡 + 记忆与规则双按钮 + 会话预设说明卡齐全,无禁用文案", () => {
    const html = renderToStaticMarkup(createElement(AiConfigHome, { onShowFiles: host.onShowFiles, onShowLint: host.onShowLint }));
    for (const label of ["引擎配置", "Skills", "MCP", "Magic Context", "记忆文件", "规则体检", "智能体 / 提示词", "会话预设"]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("该插件已停用");
  });

  it("skill-hub/assets 停用:两卡 disabled 并展示原因,其余卡可用", () => {
    disabled.push("skill-hub", "assets");
    const html = renderToStaticMarkup(createElement(AiConfigHome, { onShowFiles: host.onShowFiles, onShowLint: host.onShowLint }));
    expect(html.match(/<button[^>]*\sdisabled=/g)?.length ?? 0).toBe(2);
    expect(html).toContain("该插件已停用,在插件市场启用后重启生效");
  });
});
