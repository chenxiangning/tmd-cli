/**
 * 工作台纯函数层测试:风险分级边界、周界、任务板与待跟进分桶、筛选组合。
 * 移植 projectHub 测试语义,任务实体口径(todos → tasks)。
 */

import { describe, expect, it } from "vitest";
import { dayStart, daysLeft, endOfWeek, formatRemaining, openTasks, projectRisk, sortByRisk, todayISO } from "../analysis";
import { collectLinkedSessions, linkableWorkspaces, pendingAutoDoing, resolveWorkspaceId, summarize } from "../views";
import { followUpBuckets } from "../followUpBuckets";
import { dueTasks, taskStatusCounts } from "../summaryData";
import { canDrop, isRecentDone } from "../screens/boardDnd";
import { taskPrompt } from "../taskPrompt";
import { normalizeProject, type Project, type TaskStatus } from "../types";
import type { Workspace } from "@kernel/workspace";

const TODAY = "2026-10-10";

function project(partial: Partial<Project>): Project {
  return normalizeProject({ id: "p-x", name: "项目", module: "公司项目", status: "进行中", owner: "我", tags: [], createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, updates: [], tasks: [], ...partial });
}

describe("cwd → 工作区 id 解析", () => {
  const workspaces = [
    { id: "default", name: "default", root: "/home/u/ws", createdAt: 0 },
    { id: "ws-demo", name: "springboot-demo", root: "/home/u/ws/springboot-demo", createdAt: 0 },
    { id: "ws-deep", name: "deep", root: "/home/u/ws/springboot-demo/module-a", createdAt: 0 },
  ] satisfies Workspace[];

  it("root 精确命中优先;子目录取最深前缀;兄弟目录不劫持、落兜底前缀", () => {
    expect(resolveWorkspaceId(workspaces, "/home/u/ws/springboot-demo")).toBe("ws-demo");
    expect(resolveWorkspaceId(workspaces, "/home/u/ws/springboot-demo/module-a/src")).toBe("ws-deep");
    expect(resolveWorkspaceId(workspaces, "/home/u/ws/springboot-demo-x")).toBe("default"); /* 前缀按路径段,不认字符串前缀 */
    expect(resolveWorkspaceId(workspaces, "/elsewhere")).toBeUndefined();
    expect(resolveWorkspaceId(workspaces, undefined)).toBeUndefined();
  });
});

describe("taskPrompt(开新会话预填文本)", () => {
  it("含任务标题/说明/回写约定;附件逐条列磁盘路径", () => {
    const proj = project({ id: "p-demo", name: "springboot-demo", cwd: "/tmp/demo", tasks: [{ id: "t-1", title: "项目分析", description: "梳理模块", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [{ id: "a-1", name: "需求说明.md", fileName: "a-1.md", size: 15360, createdAt: `${TODAY}T00:00:00Z` }], sessions: [], updates: [] }] });
    const prompt = taskPrompt(proj, proj.tasks[0]);
    expect(prompt).toContain("我在推进任务「项目分析」(项目:springboot-demo / 公司项目)");
    expect(prompt).toContain("任务说明:梳理模块");
    expect(prompt).toContain("AI-TASKS.md");
    expect(prompt).toContain("updates[]");
    expect(prompt).toContain("- 附件:需求说明.md(磁盘路径 ~/.tmd-cli/workbench/docs/project-p-demo/a-1.md,15 KB)");
  });

  it("无附件不出附件段", () => {
    const proj = project({ id: "p-demo", name: "springboot-demo", tasks: [{ id: "t-1", title: "任务", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [], updates: [] }] });
    expect(taskPrompt(proj, proj.tasks[0])).not.toContain("附件");
  });
});

describe("风险分级边界", () => {
  it("已完成压过一切(即使已逾期);阻塞次之;无 DDL = 未排期", () => {
    expect(projectRisk(project({ status: "已完成", dueDate: "2026-01-01" }), TODAY).level).toBe("done");
    expect(projectRisk(project({ status: "阻塞", dueDate: "2026-12-01" }), TODAY).level).toBe("blocked");
    expect(projectRisk(project({ status: "进行中" }), TODAY).level).toBe("unscheduled");
  });

  it("逾期 → 紧急(≤3 天)→ 临近(≤7 天)→ 正常", () => {
    expect(projectRisk(project({ dueDate: "2026-10-09" }), TODAY).level).toBe("overdue");
    expect(projectRisk(project({ dueDate: "2026-10-13" }), TODAY).level).toBe("urgent");
    expect(projectRisk(project({ startedOn: "2026-10-09", dueDate: "2026-10-16" }), TODAY).level).toBe("soon");
    expect(projectRisk(project({ startedOn: "2026-10-09", dueDate: "2027-01-01", progress: 20 }), TODAY).level).toBe("normal");
  });

  it("进度落后:时间比例 - 进度 ≥ 30% 判进度风险(紧急优先于进度风险)", () => {
    const slipping = project({ startedOn: "2026-09-01", dueDate: "2026-10-20", progress: 10 });
    expect(projectRisk(slipping, TODAY).level).toBe("slipping");
    const urgent = project({ startedOn: "2026-09-01", dueDate: "2026-10-12", progress: 0 });
    expect(projectRisk(urgent, TODAY).level).toBe("urgent");
  });

  it("日期演算:本地日历日比较,跨年不炸", () => {
    expect(daysLeft("2026-10-10", TODAY)).toBe(0);
    expect(daysLeft("2027-01-01", TODAY)).toBe(83);
    expect(dayStart("不是日期")).toBeNull();
    expect(formatRemaining("2026-10-10", TODAY)).toBe("今天到期");
    expect(formatRemaining(undefined, TODAY)).toBe("未排期");
    /* 2026-10-10 是周六 → 本周日 = 10-11 */
    expect(endOfWeek(TODAY)).toBe("2026-10-11");
    expect(endOfWeek("2026-10-11")).toBe("2026-10-11");
  });

  it("sortByRisk:危险在前,同风险按剩余天数,再按名称;todayISO 是本地日", () => {
    const rows = sortByRisk([
      project({ id: "p-a", name: "乙", dueDate: "2026-12-01" }),
      project({ id: "p-b", name: "甲", dueDate: "2026-10-09" }),
      project({ id: "p-c", name: "丙", dueDate: "2026-10-12" }),
    ], TODAY);
    expect(rows.map((row) => row.project.id)).toEqual(["p-b", "p-c", "p-a"]);
    expect(todayISO(new Date(2026, 9, 10))).toBe("2026-10-10");
  });
});

describe("视图筛选与汇总", () => {
  const items = [
    project({ id: "p-1", name: "逾期单", module: "公司项目", dueDate: "2026-10-01" }),
    project({ id: "p-2", name: "正常单", module: "公司项目", dueDate: "2026-12-01", progress: 50 }),
    project({ id: "p-3", name: "杂项", module: "自研", status: "已完成" }),
  ];

  it("summarize 汇总:总数/逾期/已完成", () => {
    const stats = summarize(items, TODAY);
    expect(stats.total).toBe(3);
    expect(stats.overdue).toBe(1);
    expect(stats.done).toBe(1);
  });
});

describe("任务板与待跟进分桶", () => {
  it("followUpBuckets:逾期/今天/本周内/更晚/未排期 五桶口径(2026-10-10 是周六,周日的本周内)", () => {
    const buckets = followUpBuckets([project({
      id: "p-b", name: "桶户",
      tasks: [
        { id: "t1", title: "过期", status: "todo", order: 0, createdAt: "", updatedAt: "", dueDate: "2026-10-09", attachments: [], sessions: [], updates: [] },
        { id: "t2", title: "今天", status: "doing", order: 0, createdAt: "", updatedAt: "", dueDate: "2026-10-10", attachments: [], sessions: [], updates: [] },
        { id: "t3", title: "本周", status: "todo", order: 0, createdAt: "", updatedAt: "", dueDate: "2026-10-11", attachments: [], sessions: [], updates: [] },
        { id: "t4", title: "更晚", status: "todo", order: 0, createdAt: "", updatedAt: "", dueDate: "2026-10-12", attachments: [], sessions: [], updates: [] },
        { id: "t5", title: "没排", status: "todo", order: 0, createdAt: "", updatedAt: "", attachments: [], sessions: [], updates: [] },
      ],
    })], TODAY);
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket.items.map((item) => item.title)]));
    expect(byKey.get("overdue")).toEqual(["过期"]);
    expect(byKey.get("today")).toEqual(["今天"]);
    expect(byKey.get("week")).toEqual(["本周"]);
    expect(byKey.get("later")).toEqual(["更晚"]);
    expect(byKey.get("none")).toEqual(["没排"]);
  });

  it("归一化:垃圾输入落缺省,进度夹取 0-100", () => {
    const dirty = normalizeProject({ id: "p-d", name: "  ", progress: 250, status: "瞎写", tasks: [{ title: "", status: "nope" }, { title: "合法", status: "done" }], tags: ["a", "", 42] });
    expect(dirty.name).toBe("未命名项目");
    expect(dirty.progress).toBe(100);
    expect(dirty.status).toBe("进行中");
    expect(dirty.tasks.map((task) => task.title)).toEqual(["合法"]);
    expect(dirty.tags).toEqual(["a"]);
  });
});

describe("一键关联候选", () => {
  const wss = [
    { id: "default", name: "default", root: "/w/default", createdAt: 1 },
    { id: "w1", name: "alpha", root: "/w/alpha", createdAt: 2 },
    { id: "w2", name: "beta", root: "/w/beta", createdAt: 3 },
  ];

  it("跳过 default 兜底工作区;已绑定 cwd 去重;保持工作区顺序", () => {
    expect(linkableWorkspaces(wss, []).map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(linkableWorkspaces(wss, [project({ cwd: "/w/alpha" })]).map((w) => w.id)).toEqual(["w2"]);
  });

  it("cwd 未绑定的项目不参与去重(同名也不误挡)", () => {
    expect(linkableWorkspaces(wss, [project({ name: "alpha" })]).map((w) => w.id)).toEqual(["w1", "w2"]);
  });
});

describe("任务状态自动纳管(pendingAutoDoing)", () => {
  const task = (id: string, status: TaskStatus, refs: string[]) =>
    ({ id, title: id, status, owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: refs.map((ref) => ({ ref, kind: "host" as const, profileId: "omp", title: ref, createdAt: `${TODAY}T00:00:00Z` })), updates: [] });

  it("todo 且关联会话命中活集合才推进;host id 与磁盘身份都算活;doing/done 与死链不动", () => {
    const proj = project({ id: "p-a", tasks: [
      task("t-live-host", "todo", ["pty-1"]),
      task("t-live-disk", "todo", ["cli-9"]),
      task("t-doing", "doing", ["pty-1"]),
      task("t-done", "done", ["pty-1"]),
      task("t-dead", "todo", ["pty-gone"]),
    ] });
    const live = new Set(["pty-1", "pty-2", "cli-9"]);
    expect(pendingAutoDoing([proj], live)).toEqual([
      { projectId: "p-a", taskId: "t-live-host" },
      { projectId: "p-a", taskId: "t-live-disk" },
    ]);
    expect(pendingAutoDoing([proj], new Set())).toEqual([]);
  });
});

describe("任务关联会话汇总(collectLinkedSessions)", () => {
  const linked = (ref: string, createdAt: string) =>
    ({ ref, kind: "host" as const, profileId: "omp", title: ref, createdAt });

  it("跨任务同 ref 去重只留一条;按关联时间倒序;无关联返回空", () => {
    const proj = project({ tasks: [
      { id: "t-1", title: "甲", status: "doing", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [linked("pty-2", `${TODAY}T10:00:00Z`), linked("pty-1", `${TODAY}T09:00:00Z`)], updates: [] },
      { id: "t-2", title: "乙", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [linked("pty-2", `${TODAY}T11:00:00Z`), linked("pty-3", `${TODAY}T08:00:00Z`)], updates: [] },
      { id: "t-3", title: "丙", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [], updates: [] },
    ] });
    expect(collectLinkedSessions(proj.tasks).map((l) => l.ref)).toEqual(["pty-2", "pty-1", "pty-3"]);
    expect(collectLinkedSessions([])).toEqual([]);
  });
});

describe("任务执行记录归一化(normalizeProject → task.updates)", () => {
  /* 磁盘原始形状(刻意含坏数据),直接喂 normalizeProject(入参 unknown),
   *  不走 project() 助手的 ProjectTask 类型闸。 */
  const base = { id: "t-1", title: "任务", status: "todo", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [] };
  const normalize = (task: unknown) => normalizeProject({ id: "p-x", name: "项目", tasks: [task] }).tasks[0];

  it("合法条目原样保留;坏形状落缺省;空文本滤掉;缺字段补 id/at", () => {
    const updates = normalize({ ...base, updates: [
      { id: "u-1", at: `${TODAY}T09:00:00Z`, kind: "progress", text: "完成模块梳理" },
      { id: "u-2", at: `${TODAY}T10:00:00Z`, kind: "bogus", text: "未知类型" },
      { at: `${TODAY}T11:00:00Z`, kind: "blocker", text: "卡在依赖" },
      { id: "u-4", at: `${TODAY}T12:00:00Z`, kind: "note", text: "" },
      "junk",
    ] }).updates;
    expect(updates).toHaveLength(3);
    expect(updates[0]).toEqual({ id: "u-1", at: `${TODAY}T09:00:00Z`, kind: "progress", text: "完成模块梳理" });
    expect(updates[1].kind).toBe("note"); /* 非法 kind 落 note */
    expect(updates[2].id).toMatch(/^u-/); /* 缺 id 自动补 */
    expect(updates[2].text).toBe("卡在依赖");
  });

  it("磁盘缺 updates 字段(旧数据)归一化为空数组", () => {
    expect(normalize({ ...base }).updates).toEqual([]);
  });

  it("AI 手写重复 id 时换发新 id,React key 不撞车", () => {
    const updates = normalize({ ...base, updates: [
      { id: "u-1", at: `${TODAY}T09:00:00Z`, kind: "progress", text: "第一条" },
      { id: "u-1", at: `${TODAY}T10:00:00Z`, kind: "progress", text: "第二条" },
      { id: "u-1", at: `${TODAY}T11:00:00Z`, kind: "progress", text: "第三条" },
    ] }).updates;
    expect(new Set(updates.map((u) => u.id)).size).toBe(3);
    expect(updates.map((u) => u.text)).toEqual(["第一条", "第二条", "第三条"]);
  });
});

describe("看板拖拽纯逻辑(boardDnd)", () => {
  it("canDrop:同泳道异列才放行;跨泳道/同列/空负载全拒", () => {
    const drag = { projectId: "p-1", taskId: "t-1", status: "todo" as const };
    expect(canDrop(drag, "p-1", "doing")).toBe(true);
    expect(canDrop(drag, "p-1", "todo")).toBe(false); /* 同列回拖 no-op */
    expect(canDrop(drag, "p-2", "doing")).toBe(false); /* 跨泳道禁止(任务归属项目不可变) */
    expect(canDrop(null, "p-1", "doing")).toBe(false);
  });

  it("isRecentDone:含今天共 7 个日历日;越窗/缺 doneAt 收进更早", () => {
    expect(isRecentDone({ doneAt: `${TODAY}T08:00:00Z` }, TODAY)).toBe(true);
    expect(isRecentDone({ doneAt: "2026-10-04T23:59:00Z" }, TODAY)).toBe(true); /* 窗口下界 10-04 */
    expect(isRecentDone({ doneAt: "2026-10-03T23:59:00Z" }, TODAY)).toBe(false);
    expect(isRecentDone({ doneAt: undefined }, TODAY)).toBe(false);
  });
});

describe("任务五态归一化与终结态口径", () => {
  it("review/cancelled 原样保留;未知态回落 todo;cancelled 清 doneAt 且不算未完成", () => {
    const proj = normalizeProject({ id: "p-5", name: "项目", tasks: [
      { id: "t-a", title: "甲", status: "review", startedOn: TODAY },
      { id: "t-b", title: "乙", status: "cancelled", doneAt: `${TODAY}T09:00:00Z` },
      { id: "t-c", title: "丙", status: "bogus" },
    ] });
    expect(proj.tasks.map((task) => task.status)).toEqual(["review", "cancelled", "todo"]);
    expect(proj.tasks[1].doneAt).toBeUndefined(); /* doneAt 仅 done 持有 */
    expect(openTasks(proj).map((task) => task.id)).toEqual(["t-a", "t-c"]);
  });
});

describe("概要 dashboard 数据切片(summaryData)", () => {
  const task = (id: string, status: TaskStatus, dueDate?: string) => ({
    id, title: id, status, owner: "我", order: 0,
    createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`,
    attachments: [], sessions: [], updates: [], ...(dueDate ? { dueDate } : {}),
  });

  it("taskStatusCounts:看板四态计数,已取消不进分布分母", () => {
    const proj = project({ tasks: [
      task("t-1", "todo"), task("t-2", "doing"), task("t-3", "doing"),
      task("t-4", "done"), task("t-5", "cancelled"),
    ] });
    const { counts, total } = taskStatusCounts(proj.tasks);
    expect(counts).toMatchObject({ todo: 1, doing: 2, review: 0, done: 1 });
    expect(total).toBe(4); /* cancelled 不进分母(与看板同口径) */
  });

  it("dueTasks:只收未完成且有截止日,按日升序取前 limit", () => {
    const proj = project({ tasks: [
      task("t-1", "todo", "2026-10-20"),
      task("t-2", "doing", "2026-10-11"),
      task("t-3", "done", "2026-10-01"),   /* 已完成不收 */
      task("t-4", "todo"),                  /* 无截止日不收 */
      task("t-5", "review", "2026-10-15"),
    ] });
    expect(dueTasks(proj, 2).map((item) => item.id)).toEqual(["t-2", "t-5"]);
  });
});
