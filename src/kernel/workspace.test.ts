/**
 * 工作区 store 行为契约测试。
 * 覆盖:add 入列与命名、remove 后激活回退/悬空清理、boot 时默认工作区补位、
 * 幂等 boot、持久化副作用(configWriteWorkspaces 透传列表)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configReadWorkspaces: vi.fn(),
  configWriteWorkspaces: vi.fn(),
  configDefaultWorkspaceRoot: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

type WorkspaceModule = typeof import("./workspace");

let ws: WorkspaceModule;

const DEFAULT_ROOT = "/home/u/.tmd-cli/default";

// addWorkspace 的 id 取自 Date.now,同毫秒连续 add 会撞 id;单调递增规避。
let now = 1_700_000_000_000;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockImplementation(() => now++);
  ipcMock.configReadWorkspaces.mockRejectedValue(new Error("no tauri"));
  ipcMock.configWriteWorkspaces.mockResolvedValue(undefined);
  ipcMock.configDefaultWorkspaceRoot.mockResolvedValue(DEFAULT_ROOT);
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  ws = await import("./workspace");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 等待异步 loadFromDisk 落地(以一次 persist 完成为信号)。 */
async function waitBooted(): Promise<void> {
  await vi.waitFor(() => {
    expect(ipcMock.configWriteWorkspaces).toHaveBeenCalled();
  });
}

describe("addWorkspace / removeWorkspace", () => {
  it("add:取根目录末段为显示名,返回完整条目", () => {
    const w = ws.addWorkspace("/repo/demo");
    expect(w.name).toBe("demo");
    expect(w.root).toBe("/repo/demo");
    expect(w.id).toMatch(/^ws-/);
  });

  it("add 后立即持久化当前列表", () => {
    ws.addWorkspace("/repo/demo");
    expect(ipcMock.configWriteWorkspaces).toHaveBeenCalledWith({
      list: [expect.objectContaining({ root: "/repo/demo" })],
      activeId: null,
    });
  });

  it("remove 激活中的工作区:激活回退到首个剩余项", () => {
    const a = ws.addWorkspace("/repo/a");
    const b = ws.addWorkspace("/repo/b");
    ws.setActiveWorkspace(b.id);
    ws.removeWorkspace(b.id);
    expect(ws.getActiveWorkspace()?.id).toBe(a.id);
  });

  it("remove 不存在的 id:列表与激活态不变", () => {
    const a = ws.addWorkspace("/repo/a");
    ws.setActiveWorkspace(a.id);
    ws.removeWorkspace("ghost");
    expect(ws.getActiveWorkspace()?.id).toBe(a.id);
  });

  it("remove 至空列表:activeId 回落 null", () => {
    const a = ws.addWorkspace("/repo/a");
    ws.setActiveWorkspace(a.id);
    ws.removeWorkspace(a.id);
    expect(ws.getActiveWorkspace()).toBeNull();
  });
});

describe("setActiveWorkspace", () => {
  it("切换激活并持久化 activeId", () => {
    ws.addWorkspace("/repo/a");
    const b = ws.addWorkspace("/repo/b");
    ws.setActiveWorkspace(b.id);
    expect(ws.getActiveWorkspace()?.id).toBe(b.id);
    expect(ipcMock.configWriteWorkspaces).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeId: b.id }),
    );
  });

  it("重复设置同一 id 为幂等,不再触发 persist", () => {
    const a = ws.addWorkspace("/repo/a");
    ws.setActiveWorkspace(a.id);
    const calls = ipcMock.configWriteWorkspaces.mock.calls.length;
    ws.setActiveWorkspace(a.id);
    expect(ipcMock.configWriteWorkspaces.mock.calls.length).toBe(calls);
  });

  it("activeId 悬空(指向不存在条目)时 getActiveWorkspace 返回 null", () => {
    ws.addWorkspace("/repo/a");
    ws.setActiveWorkspace("ghost");
    expect(ws.getActiveWorkspace()).toBeNull();
  });
});

describe("ensureWorkspaceBooted 加载契约", () => {
  it("磁盘列表缺默认工作区时,补到首位并采用磁盘 activeId", async () => {
    ipcMock.configReadWorkspaces.mockResolvedValue({
      list: [{ id: "w1", name: "proj", root: "/repo/proj", createdAt: 1 }],
      activeId: "w1",
    });
    ws.ensureWorkspaceBooted();
    await waitBooted();
    const written = ipcMock.configWriteWorkspaces.mock.calls.at(-1)?.[0] as {
      list: { id: string; root: string }[];
      activeId: string;
    };
    expect(written.list[0]).toMatchObject({ id: "default", root: DEFAULT_ROOT });
    expect(written.list).toHaveLength(2);
    expect(written.activeId).toBe("w1");
    expect(ws.getActiveWorkspace()?.id).toBe("w1");
  });

  it("磁盘已含默认 root 时不重复补位", async () => {
    ipcMock.configReadWorkspaces.mockResolvedValue({
      list: [{ id: "mine", name: "default", root: DEFAULT_ROOT, createdAt: 1 }],
      activeId: "mine",
    });
    ws.ensureWorkspaceBooted();
    await waitBooted();
    const written = ipcMock.configWriteWorkspaces.mock.calls.at(-1)?.[0] as {
      list: { root: string }[];
    };
    expect(written.list).toHaveLength(1);
  });

  it("磁盘 activeId 悬空时,getActiveWorkspace 返回 null 而非崩溃", async () => {
    ipcMock.configReadWorkspaces.mockResolvedValue({
      list: [{ id: "w1", name: "proj", root: "/repo/proj", createdAt: 1 }],
      activeId: "ghost",
    });
    ws.ensureWorkspaceBooted();
    await waitBooted();
    expect(ws.getActiveWorkspace()).toBeNull();
  });

  it("非 Tauri 环境(读取抛错):保持空表,不建默认工作区", async () => {
    ws.ensureWorkspaceBooted();
    await vi.waitFor(() => {
      expect(ipcMock.configReadWorkspaces).toHaveBeenCalled();
    });
    // 让 catch 分支的 emit 跑完
    await Promise.resolve();
    expect(ws.getActiveWorkspace()).toBeNull();
    expect(ipcMock.configWriteWorkspaces).not.toHaveBeenCalled();
  });

  it("幂等:重复 boot 只读一次磁盘", async () => {
    ipcMock.configReadWorkspaces.mockResolvedValue({ list: [], activeId: null });
    ws.ensureWorkspaceBooted();
    ws.ensureWorkspaceBooted();
    await waitBooted();
    expect(ipcMock.configReadWorkspaces).toHaveBeenCalledTimes(1);
  });

  it("空磁盘数据:activeId 落到列表首项(默认工作区)", async () => {
    ipcMock.configReadWorkspaces.mockResolvedValue(null);
    ws.ensureWorkspaceBooted();
    await waitBooted();
    expect(ws.getActiveWorkspace()?.id).toBe("default");
  });
});
