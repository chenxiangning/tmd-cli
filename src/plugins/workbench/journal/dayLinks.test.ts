/**
 * 日↔工作台派生关联(纯函数测试面):当日会话行 → 项目(wsId→工作区根↔
 * Project.cwd 精确匹配)与任务(TaskSessionLink 命中行身份)。spec:
 * docs/superpowers/specs/2026-10-11-workbench-journal-merge-design.md P2。
 */
import { describe, expect, it } from "vitest";
import { dayProjectLinks, dayTaskLinks } from "./dayLinks";
import type { DaySessionRow } from "./daySessions";
import type { Project } from "../types";

const ws = [
  { id: "w1", root: "/repos/alpha" },
  { id: "w2", root: "/repos/beta" },
];

const row = (over: Partial<DaySessionRow> & Pick<DaySessionRow, "id" | "wsId" | "live">): DaySessionRow => ({
  profileId: "omp",
  title: "t",
  startedAt: 0,
  modifiedAt: 0,
  wsName: "w",
  ...over,
});

const rA1 = row({ id: "s-a1", wsId: "w1", live: false, startedAt: 8 });
const rA2 = row({ id: "s-a2", wsId: "w1", live: false, startedAt: 9 });
const rB1 = row({ id: "s-b1", wsId: "w2", live: false, startedAt: 10 });
const rLive = row({ id: "app-1", wsId: "w1", live: true, startedAt: 11 });
const rOrphan = row({ id: "s-x", wsId: "w9", live: false, startedAt: 12 });
const project = (id: string, name: string, cwd: string | undefined, tasks: Project["tasks"]): Project => ({
  id,
  name,
  module: "m",
  status: "进行中",
  owner: "我",
  progress: 0,
  tags: [],
  cwd,
  docs: [],
  createdAt: "",
  updatedAt: "",
  updates: [],
  tasks,
});

const task = (id: string, title: string, sessions: Project["tasks"][number]["sessions"]): Project["tasks"][number] => ({
  id,
  title,
  status: "todo",
  order: 0,
  createdAt: "",
  updatedAt: "",
  attachments: [],
  sessions,
  updates: [],
});

const projects: Project[] = [
  project("p1", "甲项目", "/repos/alpha", [
    task("t1", "磁盘链任务", [{ ref: "s-a1", kind: "disk", profileId: "omp", title: "", createdAt: "" }]),
    task("t2", "活链任务", [{ ref: "app-1", kind: "host", profileId: "omp", title: "", createdAt: "" }]),
    task("t3", "未关联任务", []),
  ]),
  project("p2", "乙项目", "/repos/gamma", []), /* cwd 无对应工作区:永不命中 */
  project("p3", "丙项目", undefined, [
    task("t4", "无盘任务", [{ ref: "s-a1", kind: "disk", profileId: "claude", title: "", createdAt: "" }]), /* profileId 不符 */
  ]),
];

describe("dayProjectLinks(日↔项目,wsId→根↔cwd 精确匹配)", () => {
  it("命中项目的行聚成组,按组内最早会话排序;未绑定/无工作区行不入组", () => {
    const links = dayProjectLinks([rB1, rA2, rA1, rLive, rOrphan], projects, ws);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ projectId: "p1", projectName: "甲项目" });
    expect(links[0].rows.map((r) => r.id)).toEqual(["s-a1", "s-a2", "app-1"]);
  });

  it("cwd 与工作区根不一致(子目录/异根)不算命中", () => {
    expect(dayProjectLinks([rA1], [project("p2", "乙项目", "/repos/gamma", [])], ws)).toHaveLength(0);
    expect(dayProjectLinks([rA1], [project("p4", "子目录", "/repos/alpha/sub", [])], ws)).toHaveLength(0);
  });

  it("空输入/空项目安全", () => {
    expect(dayProjectLinks([], projects, ws)).toEqual([]);
    expect(dayProjectLinks([rA1], [], ws)).toEqual([]);
  });
});

describe("dayTaskLinks(日↔任务,TaskSessionLink 命中行身份)", () => {
  it("disk 链按 id+profileId 命中非活行,host 链按 id 命中活行;未关联/profile 不符不命中", () => {
    const links = dayTaskLinks([rA1, rB1, rLive], projects);
    expect(links).toEqual([
      { taskId: "t1", taskTitle: "磁盘链任务", projectId: "p1", projectName: "甲项目" },
      { taskId: "t2", taskTitle: "活链任务", projectId: "p1", projectName: "甲项目" },
    ]);
  });

  it("disk 链不命中活行,host 链不命中非活行", () => {
    expect(dayTaskLinks([rLive], [project("p1", "甲项目", "/repos/alpha", [
      task("t1", "磁盘链任务", [{ ref: "s-a1", kind: "disk", profileId: "omp", title: "", createdAt: "" }]),
    ])])).toEqual([]);
    expect(dayTaskLinks([rA1], [project("p1", "甲项目", "/repos/alpha", [
      task("t2", "活链任务", [{ ref: "s-a1", kind: "host", profileId: "omp", title: "", createdAt: "" }]),
    ])])).toEqual([]);
  });
});

describe("评审补强(2026-10-11 P2 评审)", () => {
  it("组间按组内最早会话排序(晚开项目组在前则前)", () => {
    const early = row({ id: "e1", wsId: "w2", live: false, startedAt: 1 });
    const late = row({ id: "l1", wsId: "w1", live: false, startedAt: 9 });
    const links = dayProjectLinks(
      [late, early],
      [project("pA", "甲项目", "/repos/alpha", []), project("pB", "乙项目", "/repos/beta", [])],
      ws,
    );
    expect(links.map((l) => l.projectId)).toEqual(["pB", "pA"]);
  });

  it("多工作区同根:行按 wsId 各归其主项目组(两 ws 同根各挂一项目)", () => {
    const twin = [...ws, { id: "w1b", root: "/repos/alpha" }];
    const r1 = row({ id: "a1", wsId: "w1", live: false, startedAt: 1 });
    const r1b = row({ id: "a2", wsId: "w1b", live: false, startedAt: 2 });
    const links = dayProjectLinks([r1, r1b], [project("p1", "甲项目", "/repos/alpha", [])], twin);
    expect(links).toHaveLength(1);
    expect(links[0].rows.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("cwd 尾斜杠归一:Project.cwd '/repos/alpha/' 仍命中根 '/repos/alpha'", () => {
    expect(dayProjectLinks([rA1], [project("p1", "甲项目", "/repos/alpha/", [])], ws)).toHaveLength(1);
  });

  it("同 cwd 双项目:双计是既定语义(各 chip 各归其项目,会话数各计一次)", () => {
    const two = [project("p1", "甲项目", "/repos/alpha", []), project("p1x", "甲副本", "/repos/alpha", [])];
    const links = dayProjectLinks([rA1], two, ws);
    expect(links.map((l) => l.projectId)).toEqual(["p1", "p1x"]);
    expect(links.every((l) => l.rows.length === 1)).toBe(true);
  });

  it("disk 链 × 活行:按 r.disk 凭证命中(会话恢复即转活,活行 id 已换 app 会话 id)", () => {
    const liveResumed: DaySessionRow = {
      ...rLive,
      id: "app-9",
      disk: { id: "s-a1", path: "/f.jsonl", modifiedAt: 0 } as DaySessionRow["disk"],
    };
    const links = dayTaskLinks([liveResumed], [
      project("p1", "甲项目", "/repos/alpha", [
        task("t1", "续聊任务", [{ ref: "s-a1", kind: "disk", profileId: "omp", title: "", createdAt: "" }]),
      ]),
    ]);
    expect(links).toHaveLength(1);
  });

  it("dayTaskLinks 空 rows 安全", () => {
    expect(dayTaskLinks([], projects)).toEqual([]);
  });
});
