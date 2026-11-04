/**
 * D-01 处理宿主契约 —— 启停组合矩阵与双域渲染:
 * - 两插件都启用:checkpoints 注册「处理」宿主(id 不变,label=处理),approval-inbox
 *   不再注册独立 rail 项(防双入口),boot 照常;
 * - 仅 approval-inbox 启用:注册原「审批」兜底面板;
 * - 仅 checkpoints 启用:宿主只渲染「变更」域,无「等待」死钮。
 * settings 以可变形组桩掉(disabledPlugins 驱动两路判定);node 环境无
 * localStorage,不触真 settings 单例。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@kernel/plugin";
import type { FilePanelContribution } from "@kernel/filePanel";

/** 可变禁用清单:用例内改数组内容,两插件 activate / ReviewPanel 同读一份。 */
const { disabled, bootApprovalInbox } = vi.hoisted(() => {
  const disabled: string[] = [];
  return { disabled, bootApprovalInbox: vi.fn(() => () => {}) };
});

vi.mock("@kernel/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kernel/settings")>();
  return {
    ...actual,
    getSettingsState: () => ({ settings: { disabledPlugins: disabled } }),
    useSettingsState: () => ({ settings: { disabledPlugins: disabled } }),
  };
});

vi.mock("@plugins/approval-inbox/store", () => ({ bootApprovalInbox }));
vi.mock("@plugins/approval-inbox/panel", () => ({ ApprovalInboxPanel: () => null }));
vi.mock("./CheckpointsPanel", () => ({ CheckpointsPanel: () => null }));
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k, registerMessages: () => {} }));

import { approvalInboxPlugin } from "@plugins/approval-inbox";
import { checkpointsPlugin } from "./index";
import { ReviewPanel } from "./ReviewPanel";

function collectingCtx(panels: FilePanelContribution[]) {
  return {
    registerCliProfile: () => {},
    contribute: () => {},
    registerSettingsSection: () => {},
    registerFilePanel: (c: FilePanelContribution) => panels.push(c),
    registerCommand: () => {},
    registerTabContent: () => {},
    registerMarketPanel: () => {},
    registerHomePanel: () => {},
    registerSidebarAction: () => {},
    registerAcademyCourse: () => {},
    registerRemoteFileSource: () => () => {},
    registerWorkspaceOrigin: () => () => {},
    registerSpecWrapper: () => () => {},
    registerShellSpecProvider: () => () => {},
    registerFileVisual: () => {},
    registerEditorExtension: () => () => {},
    registerTerminalLinkProvider: () => () => {},
    registerLanguageServer: () => () => {},
    registerCliConfig: () => {},
    events: { on: () => () => {}, off: () => {}, emit: () => {} },
  } as unknown as PluginContext;
}

beforeEach(() => {
  disabled.length = 0;
  bootApprovalInbox.mockClear();
});

describe("D-01 处理宿主 · 启停组合", () => {
  it("都启用:checkpoints 注册「处理」宿主,approval-inbox 不再注册 rail 项,boot 照常", () => {
    const panels: FilePanelContribution[] = [];
    void approvalInboxPlugin.activate(collectingCtx(panels));
    expect(panels.map((p) => p.id)).toEqual([]);
    expect(bootApprovalInbox).toHaveBeenCalledTimes(1);
  });

  it("都启用:checkpoints 宿主 label=处理、组件=ReviewPanel、id 不变", () => {
    const panels: FilePanelContribution[] = [];
    const cleanup = checkpointsPlugin.activate(collectingCtx(panels));
    const host = panels.find((p) => p.id === "checkpoints");
    expect(host?.label).toBe("处理");
    expect(host?.component).toBe(ReviewPanel);
    if (typeof cleanup === "function") cleanup();
  });

  it("仅 approval-inbox 启用:注册原「审批」兜底面板", () => {
    disabled.push("checkpoints");
    const panels: FilePanelContribution[] = [];
    void approvalInboxPlugin.activate(collectingCtx(panels));
    expect(panels.map((p) => p.id)).toEqual(["approval-inbox"]);
    expect(panels[0].label).toBe("审批");
  });
});

describe("D-01 处理宿主 · 双域渲染", () => {
  it("approval-inbox 启用:渲染「等待 / 变更」两域,默认等待", () => {
    const html = renderToStaticMarkup(createElement(ReviewPanel));
    expect(html).toContain("等待");
    expect(html).toContain("变更");
    expect(html.match(/class="hidden"/g)?.length ?? 0).toBe(1); /* 变更域隐藏,等待域在场 */
  });

  it("approval-inbox 禁用:只渲染「变更」域,无「等待」死钮", () => {
    disabled.push("approval-inbox");
    const html = renderToStaticMarkup(createElement(ReviewPanel));
    expect(html).not.toContain("等待");
    expect(html).toContain("变更");
    expect(html).not.toContain('class="hidden"');
  });
});
