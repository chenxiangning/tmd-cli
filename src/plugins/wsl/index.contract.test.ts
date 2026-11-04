/**
 * wsl 插件注册面与迁移契约基线(批次 B-04 护栏;F-01/F-02 前置可比基线)。
 * 覆盖 checklist 六护栏中的 wsl 两项:
 * - 四类注册:中央 tab + 右缘 rail 动作 + 远程文件源(wslr://)+ 工作区来源,
 *   另有 spec 包装与 shell spec provider 两个 ptyAdapters 面;
 * - UNC 元数据迁移:旧版添加的 UNC 工作区(wsl: null)在装载后回填
 *   { distro, hostId: null },已带元数据或非 UNC 路径不触碰。
 * 纯注册面断言,无 IPC 写;contributions/wslCore 行为契约(现有测试)不动。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@kernel/plugin";
import type { Workspace } from "@kernel/workspace";

const workspaceMock = vi.hoisted(() => ({
  getWorkspaces: vi.fn<() => Workspace[]>(() => []),
  setWorkspaceWslMeta: vi.fn(),
  addWorkspace: vi.fn(),
  /* workspacesReady 常决:迁移挂在 then 上,测试内冲洗微任务即触发。 */
  workspacesReady: Promise.resolve(),
}));
vi.mock("@kernel/workspace", () => workspaceMock);

import { wslPlugin } from "./index";
import { buildWslFileSource } from "./contributions";
import { isWslWorkspace, parseWslUnc } from "./wslCore";

interface Harness {
  tabKinds: string[];
  sidebarActions: Array<{ id: string; rail?: boolean; railGroup?: string; opensCenterTab?: boolean }>;
  fileSourceIds: string[];
  originIds: string[];
  specWrapperCalls: number;
  shellSpecCalls: number;
}

function harness(): Harness & { ctx: PluginContext } {
  const h = {
    tabKinds: [] as string[],
    sidebarActions: [] as Array<{ id: string; rail?: boolean; railGroup?: string; opensCenterTab?: boolean }>,
    fileSourceIds: [] as string[],
    originIds: [] as string[],
    specWrapperCalls: 0,
    shellSpecCalls: 0,
    ctx: null as unknown as PluginContext,
  };
  h.ctx = {
    registerTabContent: (c: { kind: string }) => h.tabKinds.push(c.kind),
    registerSidebarAction: (a: { id: string; rail?: boolean; railGroup?: string; opensCenterTab?: boolean }) =>
      h.sidebarActions.push({ id: a.id, rail: a.rail, railGroup: a.railGroup, opensCenterTab: a.opensCenterTab }),
    registerRemoteFileSource: (s: { id: string }) => h.fileSourceIds.push(s.id),
    registerWorkspaceOrigin: (o: { id: string }) => h.originIds.push(o.id),
    registerSpecWrapper: () => {
      h.specWrapperCalls++;
    },
    registerShellSpecProvider: () => {
      h.shellSpecCalls++;
    },
  } as unknown as PluginContext;
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wsl activate 四类注册", () => {
  it("tab + rail 动作 + 文件源 + 来源 + 两个 pty 适配面一次登记", () => {
    const h = harness();
    wslPlugin.activate(h.ctx);
    expect(h.tabKinds).toEqual(["wsl"]);
    expect(h.sidebarActions).toEqual([
      { id: "wsl-panel", rail: true, railGroup: "machine", opensCenterTab: true },
    ]);
    expect(h.fileSourceIds).toEqual(["wslr"]);
    expect(h.originIds).toEqual(["wsl"]);
    expect(h.specWrapperCalls).toBe(1);
    expect(h.shellSpecCalls).toBe(1);
  });
});

describe("wsl UNC 元数据迁移", () => {
  const uncWs = {
    id: "ws-unc",
    name: "legacy",
    root: "\\\\wsl.localhost\\Ubuntu\\home\\u",
    wsl: null,
  } as unknown as Workspace;
  const metaWs = {
    id: "ws-meta",
    name: "new",
    root: "\\\\wsl.localhost\\Debian\\home\\u",
    wsl: { distro: "Debian", hostId: "h1" },
  } as unknown as Workspace;
  const localWs = { id: "ws-local", name: "local", root: "/home/u/proj", wsl: null } as unknown as Workspace;

  it("wsl:null 的 UNC 工作区回填 distro + hostId:null;已带元数据/非 UNC 不触碰", async () => {
    workspaceMock.getWorkspaces.mockReturnValue([uncWs, metaWs, localWs]);
    const h = harness();
    wslPlugin.activate(h.ctx);
    await vi.waitFor(() => expect(workspaceMock.setWorkspaceWslMeta).toHaveBeenCalledTimes(1));
    expect(workspaceMock.setWorkspaceWslMeta).toHaveBeenCalledWith("ws-unc", {
      distro: "Ubuntu",
      hostId: null,
    });
  });

  it("无 UNC 工作区:零回填", async () => {
    workspaceMock.getWorkspaces.mockReturnValue([localWs]);
    const h = harness();
    wslPlugin.activate(h.ctx);
    await new Promise((r) => setTimeout(r, 20));
    expect(workspaceMock.setWorkspaceWslMeta).not.toHaveBeenCalled();
  });
});

describe("wsl 来源/文件源行为面抽查(护栏基线)", () => {
  it("文件源注册:id=wslr;UNC 解析与来源识别行为不变", () => {
    expect(buildWslFileSource().id).toBe("wslr");
    expect(parseWslUnc("\\\\wsl.localhost\\Ubuntu\\home\\u")).toEqual({
      distro: "Ubuntu",
      linuxPath: "/home/u",
    });
    expect(
      isWslWorkspace({ root: "\\\\wsl.localhost\\Ubuntu\\home\\u", wsl: null } as never),
    ).toBe(true);
    expect(isWslWorkspace({ root: "/home/u/proj" } as never)).toBe(false);
  });
});
