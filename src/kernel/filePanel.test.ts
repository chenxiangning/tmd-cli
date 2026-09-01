/**
 * 右侧面板 store 行为契约测试。
 * 覆盖:默认 mode/pinned、mode 切换幂等、togglePinned 双向切换、
 * FILE_PANEL_TABS 元数据不变量(id 唯一、仅 files/git 默认钉住)、
 * getter 返回副本(外部不可篡改内部状态)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type FilePanelModule = typeof import("./filePanel");

let panel: FilePanelModule;

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  panel = await import("./filePanel");
});

describe("mode", () => {
  it("初始 mode 为 files", () => {
    expect(panel.getFilePanelMode()).toBe("files");
  });

  it("setFilePanelMode 切换到 git", () => {
    panel.setFilePanelMode("git");
    expect(panel.getFilePanelMode()).toBe("git");
  });

  it("setFilePanelMode 同值为幂等,mode 不变", () => {
    panel.setFilePanelMode("files");
    expect(panel.getFilePanelMode()).toBe("files");
  });
});

describe("togglePinned", () => {
  it("初始钉住 [files, git]", () => {
    expect([...panel.getPinnedPanelIds()].sort()).toEqual(["files", "git"]);
  });

  it("toggle 已钉住的 tab 取消其钉住", () => {
    panel.togglePinned("files");
    expect(panel.getPinnedPanelIds()).toEqual(["git"]);
  });

  it("同一 tab 双次 toggle 恢复原状(幂等往返)", () => {
    panel.togglePinned("files");
    panel.togglePinned("files");
    expect([...panel.getPinnedPanelIds()].sort()).toEqual(["files", "git"]);
  });

  it("占位 tab(search)可加入钉住集合", () => {
    panel.togglePinned("search");
    expect(panel.getPinnedPanelIds()).toContain("search");
  });
});

describe("getter 防御性拷贝", () => {
  it("getPinnedPanelIds 返回副本,改返回值不影响内部状态", () => {
    const ids = panel.getPinnedPanelIds() as string[];
    ids.push("notes");
    expect(panel.getPinnedPanelIds()).not.toContain("notes");
  });
});

describe("FILE_PANEL_TABS 元数据不变量", () => {
  it("id 全局唯一", () => {
    const ids = panel.FILE_PANEL_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("仅 files/git 默认钉住,其余均为占位", () => {
    const pinned = panel.FILE_PANEL_TABS.filter((t) => t.pinnedByDefault).map(
      (t) => t.id,
    );
    expect(pinned.sort()).toEqual(["files", "git"]);
  });

  it("每个 tab 都有非空中文 label", () => {
    for (const t of panel.FILE_PANEL_TABS) {
      expect(t.label.length).toBeGreaterThan(0);
    }
  });
});
