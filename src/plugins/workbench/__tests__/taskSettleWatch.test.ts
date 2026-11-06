/**
 * 任务结算守望纯函数测试:doing→review 外部迁移检测 + 会话退出×开放任务反查。
 * 只测纯函数(通知发射在装配层,依赖 host/ipc,不在此面)。
 */
import { describe, expect, it } from "vitest";
import { findOpenTaskByHostSession, tasksEnteringReview } from "../taskSettleWatch";
import type { Project, ProjectTask } from "../types";

const T0 = "2026-11-06T00:00:00Z";

const task = (partial: Partial<ProjectTask>): ProjectTask => ({
  id: "t-1", title: "任务", status: "doing", order: 0, createdAt: T0, updatedAt: T0,
  attachments: [], sessions: [], updates: [], ...partial,
});
const proj = (tasks: ProjectTask[], id = "p-1"): Project => ({
  id, name: "项目", module: "m", status: "进行中", owner: "我", progress: 0, tags: [],
  docs: [], createdAt: T0, updatedAt: T0, updates: [], tasks,
});

describe("tasksEnteringReview(外部快照 doing→review 迁移)", () => {
  it("doing/todo→review 命中;review→review 不重复;离开 review 不命中", () => {
    const before = proj([task({ id: "a", status: "doing" }), task({ id: "b", status: "review" }), task({ id: "c", status: "review" })]);
    const after = proj([
      task({ id: "a", status: "review" }),
      task({ id: "b", status: "review" }),
      task({ id: "c", status: "done" }),
    ]);
    const hits = tasksEnteringReview([before], [after]);
    expect(hits.map((h) => h.task.id)).toEqual(["a"]);
    expect(hits[0].projectId).toBe("p-1");
  });

  it("载前不存在(新任务直落 review)也命中;无关项目不动", () => {
    const before = proj([]);
    const after = proj([task({ id: "n", status: "review" })]);
    expect(tasksEnteringReview([before], [after]).map((h) => h.task.id)).toEqual(["n"]);
    const same = proj([task({ id: "x", status: "doing" })]);
    expect(tasksEnteringReview([same], [proj([task({ id: "x", status: "doing" })], "p-2")])).toEqual([]);
  });
});

describe("findOpenTaskByHostSession(会话退出反查)", () => {
  const link = { ref: "pty-1", kind: "host" as const, profileId: "omp", title: "s", createdAt: T0 };

  it("开放任务×host 关联命中;done/cancelled/仅 disk 关联不命中", () => {
    const open = proj([task({ id: "t-open", sessions: [link] })]);
    expect(findOpenTaskByHostSession("pty-1", [open])?.task.id).toBe("t-open");
    const closed = proj([task({ id: "t-done", status: "done", sessions: [link] })]);
    expect(findOpenTaskByHostSession("pty-1", [closed])).toBeNull();
    const diskOnly = proj([task({ id: "t-disk", sessions: [{ ...link, kind: "disk", ref: "pty-1" }] })]);
    expect(findOpenTaskByHostSession("pty-1", [diskOnly])).toBeNull();
    expect(findOpenTaskByHostSession("pty-other", [open])).toBeNull();
  });
});
