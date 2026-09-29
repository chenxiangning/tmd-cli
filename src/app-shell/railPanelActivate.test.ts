import { describe, expect, it, vi, beforeEach } from "vitest";

const filePanel = vi.hoisted(() => ({ setFilePanelMode: vi.fn() }));
const tabs = vi.hoisted(() => ({ closeTab: vi.fn() }));
vi.mock("@kernel/filePanel", () => ({ setFilePanelMode: filePanel.setFilePanelMode }));
vi.mock("@kernel/tabs", () => ({ closeTab: tabs.closeTab }));

import { activateRailPanel } from "./railPanelActivate";
import type { FilePanelContribution } from "@kernel/filePanel";

function panel(id: string, centerTabId?: string): FilePanelContribution {
  return {
    id,
    label: id,
    icon: () => null,
    component: () => null,
    ...(centerTabId
      ? { centerTab: { id: centerTabId, open: vi.fn() } }
      : {}),
  };
}

const files = panel("files");
const mcp = panel("mcp-hub", "mcp-hub");
const skill = panel("skill-hub", "skill-hub");
const panels = [files, mcp, skill];

beforeEach(() => {
  filePanel.setFilePanelMode.mockClear();
  tabs.closeTab.mockClear();
});

describe("activateRailPanel", () => {
  it("未激活 hub 面板:切右栏 + 开自己中央 tab + 关其他 hub 中央 tab + 展开右栏", () => {
    activateRailPanel(skill, { panels, mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("skill-hub");
    expect(tabs.closeTab).toHaveBeenCalledTimes(1);
    expect(tabs.closeTab).toHaveBeenCalledWith("mcp-hub");
    expect(skill.centerTab!.open).toHaveBeenCalledTimes(1);
  });

  it("未激活纯面板:切右栏并展开,同时清理其他 hub 遗留的中央 tab", () => {
    activateRailPanel(files, { panels, mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("files");
    expect(tabs.closeTab).toHaveBeenCalledTimes(2);
    expect(tabs.closeTab).toHaveBeenCalledWith("mcp-hub");
    expect(tabs.closeTab).toHaveBeenCalledWith("skill-hub");
  });

  it("已激活纯面板且右栏展开再点:仅折叠右栏,无切换无关闭", () => {
    activateRailPanel(files, { panels, mode: "files", rightOpen: true, setRightOpen: (o) => expect(o).toBe(false) });
    expect(filePanel.setFilePanelMode).not.toHaveBeenCalled();
    expect(tabs.closeTab).not.toHaveBeenCalled();
  });

  it("已激活 hub 面板且右栏展开再点:关自己中央 tab + 折叠右栏,不开不切", () => {
    activateRailPanel(mcp, { panels, mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(false) });
    expect(filePanel.setFilePanelMode).not.toHaveBeenCalled();
    expect(tabs.closeTab).toHaveBeenCalledTimes(1);
    expect(tabs.closeTab).toHaveBeenCalledWith("mcp-hub");
    expect(mcp.centerTab!.open).not.toHaveBeenCalled();
  });

  it("已激活但右栏已折叠再点:恢复 = 重开中央 tab + 展开右栏,不清其他 tab", () => {
    activateRailPanel(mcp, { panels, mode: "mcp-hub", rightOpen: false, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("mcp-hub");
    expect(tabs.closeTab).not.toHaveBeenCalled();
    expect(mcp.centerTab!.open).toHaveBeenCalledTimes(1);
  });
});
