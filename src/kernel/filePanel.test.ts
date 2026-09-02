/**
 * 右栏面板注册表行为契约测试。
 * 覆盖:注册排序/重复抛错/首注册即激活、pinnedByDefault 播种、
 * mode 切换幂等、togglePinned 双向切换、getter 防御性拷贝。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FilePanelModule = typeof import("./filePanel");

let panel: FilePanelModule;

const DummyIcon = () => null;
const DummyPanel = () => null;

function contribution(
  id: string,
  extra?: Partial<import("./filePanel").FilePanelContribution>,
): import("./filePanel").FilePanelContribution {
  return { id, label: id, icon: DummyIcon, component: DummyPanel, ...extra };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  panel = await import("./filePanel");
});

describe("registerFilePanel", () => {
  it("首个注册面板自动成为激活 mode", () => {
    panel.registerFilePanel(contribution("files"));
    expect(panel.getFilePanelMode()).toBe("files");
    expect(panel.getFilePanels().map((p) => p.id)).toEqual(["files"]);
  });

  it("按 order 升序排列,缺省按 0", () => {
    panel.registerFilePanel(contribution("git", { order: 1 }));
    panel.registerFilePanel(contribution("files", { order: 0 }));
    expect(panel.getFilePanels().map((p) => p.id)).toEqual(["files", "git"]);
  });

  it("重复 id 注册即抛错", () => {
    panel.registerFilePanel(contribution("files"));
    expect(() => panel.registerFilePanel(contribution("files"))).toThrow(/重复注册/);
  });

  it("pinnedByDefault 缺省钉住,显式 false 不钉", () => {
    panel.registerFilePanel(contribution("files"));
    panel.registerFilePanel(contribution("git", { pinnedByDefault: false }));
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
  });
});

describe("mode", () => {
  it("setFilePanelMode 切换激活面板", () => {
    panel.registerFilePanel(contribution("files"));
    panel.setFilePanelMode("git");
    expect(panel.getFilePanelMode()).toBe("git");
  });

  it("setFilePanelMode 同值为幂等", () => {
    panel.registerFilePanel(contribution("files"));
    panel.setFilePanelMode("files");
    expect(panel.getFilePanelMode()).toBe("files");
  });
});

describe("togglePinned", () => {
  it("toggle 已钉住的面板取消其钉住", () => {
    panel.registerFilePanel(contribution("files"));
    panel.togglePinned("files");
    expect(panel.getPinnedPanelIds()).toEqual([]);
  });

  it("同一面板双次 toggle 恢复原状(幂等往返)", () => {
    panel.registerFilePanel(contribution("files"));
    panel.togglePinned("files");
    panel.togglePinned("files");
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
  });
});

describe("getter 防御性拷贝", () => {
  it("getPinnedPanelIds 返回副本,改返回值不影响内部状态", () => {
    panel.registerFilePanel(contribution("files"));
    const ids = panel.getPinnedPanelIds() as string[];
    ids.push("notes");
    expect(panel.getPinnedPanelIds()).not.toContain("notes");
  });
});
