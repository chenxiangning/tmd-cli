/**
 * 工作区分组语义测试(groups.ts)。
 * 覆盖:分桶保序与非法 groupId 兜底、组名校验(空/保留名/重名大小写不敏感)、
 * 重命名自身豁免、moveGroup 换位与边界 no-op、删组回落未分组、assignToGroup 归一。
 * settings/workspace 走真实模块单例(ipc 打桩),用例间清理共享态。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  configWriteWorkspaces: vi.fn().mockResolvedValue(undefined),
  configWriteSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import { getSettingsState, updateSettings } from "@kernel/settings";
import { addWorkspace, getWorkspaces, removeWorkspace } from "@kernel/workspace";
import {
  assignToGroup,
  createGroup,
  deleteGroup,
  groupWorkspaces,
  moveGroup,
  renameGroup,
  validateGroupName,
} from "./groups";

function resetShared(): void {
  updateSettings({ workspaceGroups: [], workspaceGroupCollapsedMap: {} });
  for (const w of getWorkspaces()) removeWorkspace(w.id);
}

beforeEach(resetShared);

/** 唯一组名(用例共享单例,防跨用例重名干扰)。 */
let seq = 0;
const uniq = (base: string) => `${base}-${++seq}`;

describe("groupWorkspaces 派生", () => {
  it("按 groupId 分桶,桶内保持数组序;空组保留空桶", () => {
    const g1 = { id: "g1", name: "A" };
    const g2 = { id: "g2", name: "B" };
    const list = [
      { id: "w1", name: "w1", root: "/a", createdAt: 1, groupId: "g1" },
      { id: "w2", name: "w2", root: "/b", createdAt: 2 },
      { id: "w3", name: "w3", root: "/c", createdAt: 3, groupId: "g1" },
    ];
    const r = groupWorkspaces(list, [g1, g2]);
    expect(r.ungrouped.map((w) => w.id)).toEqual(["w2"]);
    expect(r.named[0].workspaces.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(r.named[1].workspaces).toEqual([]);
  });

  it("非法 groupId(组已删)归未分组,不回写", () => {
    const list = [{ id: "w1", name: "w1", root: "/a", createdAt: 1, groupId: "ghost" }];
    const r = groupWorkspaces(list, []);
    expect(r.ungrouped.map((w) => w.id)).toEqual(["w1"]);
    expect(list[0].groupId).toBe("ghost");
  });
});

describe("组名校验与创建", () => {
  it("空名 / 保留名(大小写不敏感) / 重名 拒绝", () => {
    expect(createGroup(uniq("前端"))).toBeNull();
    expect(validateGroupName("  ")).toBe("组名不能为空");
    expect(validateGroupName("未分组")).toBe("「未分组」是保留名,不能用作组名");
    expect(validateGroupName("UNGROUPEd")).toBe("「未分组」是保留名,不能用作组名");
    expect(validateGroupName("前端-1")).toBe("组名已存在");
    expect(createGroup("前端-1")).toBe("组名已存在");
  });

  it("创建成功:trim 后落库,数组序即显示序", () => {
    expect(createGroup(`  ${uniq("后端")}  `)).toBeNull();
    const groups = getSettingsState().settings.workspaceGroups;
    expect(groups.at(-1)?.name).toBe("后端-2");
  });
});

describe("renameGroup", () => {
  it("重命名自身豁免重名;与他人重名拒绝", () => {
    createGroup(uniq("甲"));
    createGroup(uniq("乙"));
    const [a, b] = getSettingsState().settings.workspaceGroups;
    expect(renameGroup(a.id, a.name)).toBeNull();
    expect(renameGroup(b.id, a.name)).toBe("组名已存在");
    expect(renameGroup(b.id, uniq("丙"))).toBeNull();
    expect(getSettingsState().settings.workspaceGroups[1].name).toBe("丙-5");
  });
});

describe("moveGroup", () => {
  it("相邻换位;越界 no-op", () => {
    createGroup(uniq("一"));
    createGroup(uniq("二"));
    const ids = () => getSettingsState().settings.workspaceGroups.map((g) => g.name);
    const [a] = getSettingsState().settings.workspaceGroups;
    moveGroup(a.id, "down");
    expect(ids()).toEqual(["二-7", "一-6"]);
    moveGroup(a.id, "down");
    expect(ids()).toEqual(["二-7", "一-6"]);
    moveGroup(a.id, "up");
    expect(ids()).toEqual(["一-6", "二-7"]);
  });
});

describe("deleteGroup / assignToGroup", () => {
  it("删组:组内工作区落回未分组,组移除", () => {
    createGroup(uniq("删"));
    const g = getSettingsState().settings.workspaceGroups[0];
    const ws = addWorkspace("/repo/del-demo");
    assignToGroup(ws.id, g.id);
    expect(getWorkspaces().find((w) => w.id === ws.id)?.groupId).toBe(g.id);
    deleteGroup(g.id);
    expect(getSettingsState().settings.workspaceGroups).toEqual([]);
    expect(getWorkspaces().find((w) => w.id === ws.id)?.groupId).toBeNull();
  });

  it("assignToGroup:非法 groupId 归一为 null", () => {
    const ws = addWorkspace("/repo/ghost-demo");
    assignToGroup(ws.id, "ghost");
    expect(getWorkspaces().find((w) => w.id === ws.id)?.groupId ?? null).toBeNull();
  });
});
