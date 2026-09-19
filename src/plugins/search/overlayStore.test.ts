/**
 * overlayStore 契约(search 插件共享浮层单例):
 * 初始为 null(关);openSearchOverlay 置 kind;同刻最多一个,再开顶替;
 * closeSearchOverlay 置 null,已关时再关幂等(快照保持 null),关后可再开;
 * useActiveWorkspaceRoot 选择逻辑:激活工作区 root 优先,activeId 未命中
 * 清单回落首项,清单为空返回 null。
 * 手法:store 是模块级单例,vi.resetModules + 动态 import;useWorkspaces 以
 * vi.mock 顶替(node 环境不触真 workspace 内核);use* React 订阅面跳过不测。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const wsMock = vi.hoisted(() => ({ useWorkspaces: vi.fn() }));
vi.mock("@kernel/workspace", () => wsMock);

type Mod = typeof import("./overlayStore");
let mod: Mod;

beforeEach(async () => {
  wsMock.useWorkspaces.mockReset();
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  mod = await import("./overlayStore");
});

describe("searchOverlayKind 开合状态机", () => {
  it("初始关闭(null),open 置 kind,再开顶替", () => {
    expect(mod.searchOverlayKind()).toBeNull();
    mod.openSearchOverlay("panel");
    expect(mod.searchOverlayKind()).toBe("panel");
    mod.openSearchOverlay("quickOpen");
    expect(mod.searchOverlayKind()).toBe("quickOpen");
  });

  it("close 置 null;已关时再关幂等,保持 null", () => {
    mod.openSearchOverlay("panel");
    mod.closeSearchOverlay();
    expect(mod.searchOverlayKind()).toBeNull();
    mod.closeSearchOverlay();
    expect(mod.searchOverlayKind()).toBeNull();
  });

  it("open→close→open 往返,新 kind 生效", () => {
    mod.openSearchOverlay("quickOpen");
    mod.closeSearchOverlay();
    mod.openSearchOverlay("panel");
    expect(mod.searchOverlayKind()).toBe("panel");
  });
});

describe("useActiveWorkspaceRoot 选择逻辑", () => {
  it("激活工作区的 root 优先", () => {
    wsMock.useWorkspaces.mockReturnValue({
      list: [
        { id: "ws1", root: "/a" },
        { id: "ws2", root: "/b" },
      ],
      activeId: "ws2",
    });
    expect(mod.useActiveWorkspaceRoot()).toBe("/b");
  });

  it("activeId 未命中清单回落首项;清单为空返回 null", () => {
    wsMock.useWorkspaces.mockReturnValue({
      list: [
        { id: "ws1", root: "/a" },
        { id: "ws2", root: "/b" },
      ],
      activeId: "missing",
    });
    expect(mod.useActiveWorkspaceRoot()).toBe("/a");
    wsMock.useWorkspaces.mockReturnValue({ list: [], activeId: "ws1" });
    expect(mod.useActiveWorkspaceRoot()).toBeNull();
  });
});
