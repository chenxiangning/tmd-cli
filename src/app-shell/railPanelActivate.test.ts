import { describe, expect, it, vi, beforeEach } from "vitest";

const filePanel = vi.hoisted(() => ({ setFilePanelMode: vi.fn() }));
vi.mock("@kernel/filePanel", () => ({ setFilePanelMode: filePanel.setFilePanelMode }));

import { activateRailPanel } from "./railPanelActivate";
import type { FilePanelContribution } from "@kernel/filePanel";

function panel(id: string, withCenterTab = false): FilePanelContribution {
  return {
    id,
    label: id,
    icon: () => null,
    component: () => null,
    ...(withCenterTab ? { centerTab: { open: vi.fn() } } : {}),
  };
}

const files = panel("files");
const mcp = panel("mcp-hub", true);
const skill = panel("skill-hub", true);

beforeEach(() => {
  filePanel.setFilePanelMode.mockClear();
});

describe("activateRailPanel", () => {
  it("未激活 hub 面板:切右栏 + 开自己中央 tab + 展开右栏,不碰任何其他中央 tab", () => {
    activateRailPanel(skill, { mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("skill-hub");
    expect(skill.centerTab!.open).toHaveBeenCalledTimes(1);
  });

  it("hub 面板之间互不关闭:mcp 打开时 skill 的中央 tab 原样共存", () => {
    activateRailPanel(skill, { mode: "files", rightOpen: false, setRightOpen: () => {} });
    activateRailPanel(mcp, { mode: "skill-hub", rightOpen: true, setRightOpen: () => {} });
    expect(skill.centerTab!.open).toHaveBeenCalledTimes(1);
    expect(mcp.centerTab!.open).toHaveBeenCalledTimes(1);
    expect(filePanel.setFilePanelMode).toHaveBeenLastCalledWith("mcp-hub");
  });

  it("未激活纯面板:只切右栏并展开,无任何中央 tab 调用", () => {
    activateRailPanel(files, { mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("files");
    expect(files.centerTab).toBeUndefined();
  });

  it("已激活面板且右栏展开再点:仅折叠右栏(容器开关),中央 tab 保留", () => {
    activateRailPanel(mcp, { mode: "mcp-hub", rightOpen: true, setRightOpen: (o) => expect(o).toBe(false) });
    expect(filePanel.setFilePanelMode).not.toHaveBeenCalled();
    expect(mcp.centerTab!.open).not.toHaveBeenCalled();
  });

  it("已激活但右栏已折叠的 centerTab 面板再点:只聚焦中央 tab,不重开右栏(右栏对 hub 类只是副展示)", () => {
    activateRailPanel(mcp, { mode: "mcp-hub", rightOpen: false, setRightOpen: () => {
      throw new Error("不应重开右栏");
    } });
    expect(filePanel.setFilePanelMode).not.toHaveBeenCalled();
    expect(mcp.centerTab!.open).toHaveBeenCalledTimes(1);
  });

  it("已激活但右栏已折叠的纯面板再点:重开右栏(右栏即面板本体)", () => {
    activateRailPanel(files, { mode: "files", rightOpen: false, setRightOpen: (o) => expect(o).toBe(true) });
    expect(filePanel.setFilePanelMode).toHaveBeenCalledWith("files");
  });
});
