/**
 * ports · 数据整形单测 —— 暴露面/去重/家族折叠/会话归因;kill 命令形状。
 */

import { describe, expect, it, vi } from "vitest";
import { killCommand } from "./portsKill";
import { dedupeListeners, exposureOf, findOwnerSession, groupByFamily, rowKey, sortGroups } from "./portsTree";
import type { PortEntry } from "./types";

vi.mock("@kernel/ipc", () => ({ ipc: {} }));

function entry(port: number, pid: number | null, ppid: number | null, addr = "127.0.0.1"): PortEntry {
  return { port, addr, exposure: exposureOf(addr), pid, process: "proc", args: "", ppid, cwd: null, gitRoot: null };
}

describe("exposureOf", () => {
  it("通配/网卡地址暴露,回环仅本机", () => {
    for (const host of ["*", "0.0.0.0", "::", "[::]", "192.168.1.5"]) {
      expect(exposureOf(host)).toBe("exposed");
    }
    for (const host of ["127.0.0.1", "::1"]) {
      expect(exposureOf(host)).toBe("loopback");
    }
  });
});

describe("dedupeListeners", () => {
  it("同 pid+port 双协议族去重,保留暴露面更宽的地址", () => {
    const rows = [entry(56932, 687, 1, "127.0.0.1"), entry(56932, 687, 1, "*")];
    expect(dedupeListeners(rows)).toEqual([entry(56932, 687, 1, "*")]);
  });
});

describe("groupByFamily(监听进程家族折叠)", () => {
  it("父监听进程收子进程,三层链嵌进顶层组,按端口排序", () => {
    const rows = [entry(3000, 10, 1), entry(9229, 11, 10), entry(5432, 12, 999), entry(6379, null, null), entry(1002, 22, 21), entry(1000, 20, 1), entry(1001, 21, 20)];
    const tops = groupByFamily(rows);
    expect(tops.map((g) => [g.top.port, g.children.map((c) => c.port)])).toEqual([
      [1000, [1001, 1002]],
      [3000, [9229]],
      [5432, []],
      [6379, []],
    ]);
  });

  it("同 pid 多端口全部收组,一行不丢(建组者做顶层,其余做子行)", () => {
    const rows = [entry(7000, 692, 1), entry(5000, 692, 1), entry(14013, 81753, 1), entry(14016, 81753, 1), entry(14019, 81753, 1)];
    const tops = groupByFamily(rows);
    expect(tops).toHaveLength(2);
    expect(tops.reduce((n, g) => n + 1 + g.children.length, 0)).toBe(rows.length);
    const wechat = tops.find((g) => g.top.pid === 81753)!;
    expect(wechat.children.map((c) => c.port)).toEqual([14016, 14019]);
  });

  it("ppid 自环不挂死", () => {
    const tops = groupByFamily([entry(7000, 30, 30)]);
    expect(tops).toHaveLength(1);
    expect(tops[0].top.pid).toBe(30);
  });
});

describe("sortGroups(列头排序:组按顶层行键排,组内子行同键排)", () => {
  const wsNames = new Map([["/repo/a", "ws-a"]]);
  const rows: PortEntry[] = [
    { ...entry(3000, 10, 1), process: "node", gitRoot: "/repo/b" },
    { ...entry(9229, 11, 10), process: "node" },
    { ...entry(80, 12, 1, "*"), process: "nginx", gitRoot: "/repo/a" },
    { ...entry(8080, 13, 1), process: "python" },
    { ...entry(9999, 14, 1), process: "weird" },
  ];
  const groups = groupByFamily(rows);

  it("端口列:数值升降序,子行组内同键排", () => {
    const desc = sortGroups(groups, { key: "port", dir: "desc" }, wsNames);
    expect(desc.map((g) => g.top.port)).toEqual([9999, 8080, 3000, 80]);
    expect(desc.find((g) => g.top.port === 3000)!.children.map((c) => c.port)).toEqual([9229]);
  });

  it("暴露面列:仅本机升序在前", () => {
    const asc = sortGroups(groups, { key: "exposure", dir: "asc" }, wsNames);
    expect(asc.map((g) => g.top.exposure)).toEqual(["loopback", "loopback", "loopback", "exposed"]);
  });

  it("空仓库/无用途恒沉底,不随方向翻", () => {
    const byRepo = sortGroups(groups, { key: "repo", dir: "desc" }, wsNames);
    expect(byRepo.map((g) => g.top.port)).toEqual([80, 3000, 8080, 9999]);
    const byPurpose = sortGroups(groups, { key: "purpose", dir: "asc" }, wsNames);
    expect(byPurpose.map((g) => g.top.port)).toEqual([80, 8080, 3000, 9999]);
  });

  it("仓库列:工作区名命中时按显示名排", () => {
    const asc = sortGroups(groups, { key: "repo", dir: "asc" }, wsNames);
    expect(asc.map((g) => g.top.port)).toEqual([3000, 80, 8080, 9999]);
  });
});

describe("findOwnerSession(ppid 链归因)", () => {
  const sessionByPid = new Map([[38, { id: "s1", profileId: "omp" }]]);
  const chain = new Map([
    [40, 39],
    [39, 38],
    [38, 1],
  ]);
  const ppidOf = (p: number) => chain.get(p) ?? null;

  it("链上溯命中会话 pid", () => {
    expect(findOwnerSession(40, ppidOf, sessionByPid)?.id).toBe("s1");
    expect(findOwnerSession(38, ppidOf, sessionByPid)?.id).toBe("s1");
  });

  it("无命中/环防御/深度上限返回 null", () => {
    expect(findOwnerSession(40, ppidOf, new Map())).toBeNull();
    const cyc = new Map([
      [50, 51],
      [51, 50],
    ]);
    expect(findOwnerSession(50, (p) => cyc.get(p) ?? null, sessionByPid)).toBeNull();
    let deep = 100;
    const longChain = new Map<number, number>();
    for (let i = 0; i < 40; i++) {
      longChain.set(deep, deep - 1);
      deep--;
    }
    expect(findOwnerSession(100, (p) => longChain.get(p) ?? null, new Map([[60, { id: "s", profileId: "omp" }]]))).toBeNull();
  });
});

describe("killCommand(命令形状)", () => {
  it("unix 两段杀形状 / windows 杀树形状", () => {
    expect(killCommand(123, "mac")).toBe("kill -9 123");
    expect(killCommand(123, "linux")).toBe("kill -9 123");
    expect(killCommand(123, "windows")).toBe("taskkill /F /T /PID 123");
  });
});

describe("rowKey", () => {
  it("pid 缺失回落 addr:port 保持行身份", () => {
    expect(rowKey(entry(8080, 5, 1))).toBe("5:8080");
    expect(rowKey(entry(8080, null, null))).toBe("127.0.0.1:8080");
  });
});
