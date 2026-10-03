/**
 * 右栏面板注册表行为契约测试。
 * 覆盖:注册排序/重复抛错/首注册即激活、pinnedByDefault 播种、
 * mode 切换幂等、togglePinned 双向切换、getter 防御性拷贝、钉住清单 localStorage 持久化。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** 极简 localStorage stub(node 环境无 Web Storage);返回底图供断言。 */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  });
  return map;
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  panel = await import("./filePanel");
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("钉住持久化(localStorage)", () => {
  it("togglePinned 全量覆写存储", () => {
    const store = stubLocalStorage();
    panel.registerFilePanel(contribution("files"));
    panel.registerFilePanel(contribution("git", { pinnedByDefault: false }));
    panel.togglePinned("git");
    expect(JSON.parse(store.get("tmd.filePanel.pinned.v1") ?? "null")).toEqual(["files", "git"]);
    panel.togglePinned("files");
    expect(JSON.parse(store.get("tmd.filePanel.pinned.v1") ?? "null")).toEqual(["git"]);
  });

  it("重启(全新模块实例)后按存储清单钉住,pinnedByDefault 不再生效", async () => {
    stubLocalStorage({ "tmd.filePanel.pinned.v1": JSON.stringify(["git"]) });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files")); // 缺省 true,不在清单 → 不钉
    panel.registerFilePanel(contribution("git", { pinnedByDefault: false })); // 清单在列 → 钉
    expect(panel.getPinnedPanelIds()).toEqual(["git"]);
  });

  it("存储空数组同样权威(用户全部取消钉住也持久化)", async () => {
    stubLocalStorage({ "tmd.filePanel.pinned.v1": "[]" });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files"));
    expect(panel.getPinnedPanelIds()).toEqual([]);
  });

  it("存储脏数据(非数组)回落 pinnedByDefault 播种", async () => {
    stubLocalStorage({ "tmd.filePanel.pinned.v1": '{"pinned":true}' });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files"));
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
  });
});

describe("registerRailActionPin pinOnce(一次性补钉)", () => {
  it("存量清单无此 id 时自动钉一次,合并写不截断未注册项", async () => {
    /* 入口迁移场景:tmd.filePanel.pinned.v1 先于动作存在,缺 id 本应不钉;
     * pinOnce 补钉 + autopin marker 留痕。写盘必须是「原清单 ∪ {id}」——
     * 插件串行激活,此刻 memory 面板尚未注册,全量覆写会截断丢钉(P0 回归锁)。 */
    const store = stubLocalStorage({ "tmd.filePanel.pinned.v1": JSON.stringify(["files", "memory"]) });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerRailActionPin("system-proxy", true, true);
    /* state 快照只含本会话已注册项(此刻只补钉动作自身);写盘才是全量合并。 */
    expect(panel.getPinnedPanelIds()).toEqual(["system-proxy"]);
    expect(JSON.parse(store.get("tmd.filePanel.pinned.v1") ?? "null")).toEqual(["files", "memory", "system-proxy"]);
    expect(store.get("tmd.filePanel.autopin.system-proxy")).toBe("1");
  });

  it("手动取消钉住后重注册不复活(marker 拦截)", async () => {
    const store = stubLocalStorage({ "tmd.filePanel.pinned.v1": JSON.stringify(["files"]) });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files")); /* 注册后才入 state 快照 */
    panel.registerRailActionPin("system-proxy", true, true);
    panel.togglePinned("system-proxy"); /* 用户手动取消 */
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
    /* 重启(全新模块实例)再注册:persisted 清单无 id 且 marker 已留痕 → 不复活。 */
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files"));
    panel.registerRailActionPin("system-proxy", true, true);
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
    expect(JSON.parse(store.get("tmd.filePanel.pinned.v1") ?? "null")).toEqual(["files"]);
  });
  it("新装无清单:补钉只入 state 不落盘,默认钉播种不受污染", async () => {
    /* persisted 缺时写 key 会让清单转权威,其它面板 pinnedByDefault 全灭;
     * 且 marker 先行 —— 本会话取消钉(落盘)后,下次启动不复活(P1 回归锁)。 */
    const store = stubLocalStorage();
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerRailActionPin("system-proxy", true, true);
    expect(panel.getPinnedPanelIds()).toEqual(["system-proxy"]);
    expect(store.get("tmd.filePanel.pinned.v1")).toBeUndefined();
    panel.togglePinned("system-proxy"); /* 取消 → 首次落盘 */
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files")); /* 清单在 → 权威,默认钉失效 */
    panel.registerRailActionPin("system-proxy", true, true); /* marker 拦截,不复活 */
    expect(panel.getPinnedPanelIds()).toEqual([]);
  });

  it("pinOnce 缺省 false:存量清单无 id 不补钉", async () => {
    stubLocalStorage({ "tmd.filePanel.pinned.v1": JSON.stringify(["files"]) });
    vi.resetModules();
    panel = await import("./filePanel");
    panel.registerFilePanel(contribution("files"));
    panel.registerRailActionPin("terminal");
    expect(panel.getPinnedPanelIds()).toEqual(["files"]);
  });
});
