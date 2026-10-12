/**
 * 聚焦页模型回归:桶分派(逾期/今天/本周/更晚合并)、一句话措辞、
 * 14 天窗 DDL chip 与任务计数、项目脉搏活动排序与空壳分区。
 */
import { describe, expect, it } from "vitest";
import { activityAge, focusBand, focusBuckets, focusLine, pulsePartition } from "./focusModel";
import type { Project, ProjectTask } from "./types";

const TODAY = "2026-10-12"; /* 周一 */

let seq = 0;
function task(partial: Partial<ProjectTask>): ProjectTask {
  seq += 1;
  return {
    id: `t${seq}`, title: `任务${seq}`, status: "todo", order: seq,
    createdAt: "2026-10-01T00:00:00+08:00", updatedAt: "2026-10-01T00:00:00+08:00",
    attachments: [], sessions: [], updates: [], ...partial,
  };
}
function project(partial: Partial<Project>): Project {
  seq += 1;
  return {
    id: `p${seq}`, name: `项目${seq}`, module: "其他项目", status: "进行中", owner: "o",
    progress: 0, tags: [], docs: [], createdAt: "2026-10-01T00:00:00+08:00",
    updatedAt: "2026-10-01T00:00:00+08:00", updates: [], tasks: [], ...partial,
  };
}

describe("focusBuckets", () => {
  it("按截止分桶,已完成任务不出现", () => {
    const p = project({ name: "A", tasks: [
      task({ dueDate: "2026-10-10" }),               /* 逾期 */
      task({ dueDate: TODAY, status: "doing" }),     /* 今天 */
      task({ dueDate: "2026-10-15" }),               /* 本周 */
      task({ dueDate: "2026-10-20" }),               /* 更晚 */
      task({}),                                      /* 未排期 */
      task({ dueDate: "2026-10-10", status: "done" }),/* 已完成不进桶 */
    ] });
    const b = focusBuckets([p], TODAY);
    expect(b.main.map((x) => x.total)).toEqual([1, 1, 1]);
    expect(b.later).toHaveLength(2);
    expect(b.later[0].dueDate).toBe("2026-10-20");   /* 更晚在前,未排期沉底 */
    expect(b.later[1].dueDate).toBeUndefined();
    expect(b.later[0].status).toBe("todo");
  });

  it("本周边界 = 周日 10-18,下周一 10-19 落更晚", () => {
    const p = project({ tasks: [task({ dueDate: "2026-10-18" }), task({ dueDate: "2026-10-19" })] });
    const b = focusBuckets([p], TODAY);
    expect(b.main[2].total).toBe(1);
    expect(b.later).toHaveLength(1);
    expect(b.later[0].dueDate).toBe("2026-10-19");
  });
});

describe("focusLine", () => {
  it("有到期时给计数,非清净", () => {
    const p = project({ tasks: [task({ dueDate: "2026-10-10" }), task({ dueDate: TODAY })] });
    const pulse = pulsePartition([p], TODAY);
    const line = focusLine(focusBuckets([p], TODAY), pulse);
    expect(line.overdue).toBe(1);
    expect(line.dueToday).toBe(1);
    expect(line.calm).toBe(false);
    expect(line.active).toBe(1);
  });

  it("清净态带最近活跃项目名", () => {
    const p = project({ name: "Alpha", updates: [{ id: "u", at: "2026-10-11T09:00:00+08:00", kind: "note", text: "x" }] });
    const line = focusLine(focusBuckets([p], TODAY), pulsePartition([p], TODAY));
    expect(line.calm).toBe(true);
    expect(line.topName).toBe("Alpha");
  });

  it("无任何项目与活动也是清净态", () => {
    const line = focusLine(focusBuckets([], TODAY), pulsePartition([], TODAY));
    expect(line.calm).toBe(true);
    expect(line.topName).toBeUndefined();
  });
});

describe("focusBand", () => {
  it("固定 14 格,今天开头;DDL chip 与当日任务计数入格", () => {
    const p = project({ name: "A", dueDate: "2026-10-14", tasks: [task({ dueDate: "2026-10-14" })] });
    const band = focusBand([p], TODAY);
    expect(band).toHaveLength(14);
    expect(band[0].iso).toBe(TODAY);
    expect(band[0].isToday).toBe(true);
    expect(band[6].iso).toBe("2026-10-18");
    const day = band.find((d) => d.iso === "2026-10-14")!;
    expect(day.ddls.map((x) => x.name)).toEqual(["A"]);
    expect(day.tasks).toHaveLength(1);
    expect(day.ddls[0].tone).toBe("danger"); /* 两天内 urgent 档 */
  });

  it("窗内多项目同日各出一枚 chip", () => {
    const a = project({ name: "A", dueDate: "2026-10-15" });
    const b = project({ name: "B", dueDate: "2026-10-15" });
    const band = focusBand([a, b], TODAY);
    expect(band.find((d) => d.iso === "2026-10-15")!.ddls).toHaveLength(2);
  });
});

describe("pulsePartition", () => {
  it("有活动进脉搏按时刻倒序,无活动沉空壳按名称排", () => {
    const active1 = project({ name: "Zeta", updates: [{ id: "u1", at: "2026-10-10T08:00:00+08:00", kind: "note", text: "旧" }] });
    const active2 = project({ name: "Alpha", updates: [{ id: "u2", at: "2026-10-12T08:00:00+08:00", kind: "progress", text: "新" }] });
    const ghostB = project({ name: "Beta" });
    const ghostA = project({ name: "Able" });
    const { rows, ghosts } = pulsePartition([active1, active2, ghostB, ghostA], TODAY);
    expect(rows.map((r) => r.project.name)).toEqual(["Alpha", "Zeta"]);
    expect(ghosts.map((g) => g.name)).toEqual(["Able", "Beta"]);
    expect(rows[0].activity?.text).toBe("新");
  });

  it("超过 7 天的旧活动也沉空壳", () => {
    const stale = project({ updates: [{ id: "u", at: "2026-10-04T08:00:00+08:00", kind: "note", text: "旧闻" }] });
    const { rows, ghosts } = pulsePartition([stale], TODAY);
    expect(rows).toHaveLength(0);
    expect(ghosts).toHaveLength(1);
  });

  it("有未完成任务即使无活动也算被跟踪", () => {
    const busy = project({ name: "Busy", tasks: [task({})] });
    const { rows, ghosts } = pulsePartition([busy], TODAY);
    expect(rows.map((r) => r.project.name)).toEqual(["Busy"]);
    expect(ghosts).toHaveLength(0);
  });
});

describe("activityAge", () => {
  /* 日差 = 「时刻的本地日历日」与 today 的差:时刻串必须是 naive 本地形态
   * 才在任意时区下钉住同一本地日历日(带偏移串的本地日随 runner 时区漂)。 */
  const pad = (n: number) => String(n).padStart(2, "0");
  const localIso = (y: number, mo: number, d: number, h: number, mi: number) =>
    `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00`;
  it("本地日历日差:今天 0,昨天 1,跨年不混", () => {
    expect(activityAge(localIso(2026, 10, 12, 23, 59), TODAY)).toBe(0);
    expect(activityAge(localIso(2026, 10, 11, 0, 1), TODAY)).toBe(1);
    expect(activityAge(localIso(2025, 12, 31, 12, 0), TODAY)).toBeGreaterThan(200);
  });
});
