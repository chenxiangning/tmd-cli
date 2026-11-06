/**
 * 任务完成判据测试:taskPrompt 判据注入 + normalizeProject 归一化
 * (自 workbenchPure.test.ts 拆出守 300 行铁则,语义不变)。
 */
import { describe, expect, it } from "vitest";
import { taskPrompt } from "../taskPrompt";
import { normalizeProject, type Project } from "../types";

const TODAY = "2026-11-06";

function project(partial: Partial<Project>): Project {
  return normalizeProject({ id: "p-x", name: "项目", module: "公司项目", status: "进行中", owner: "我", tags: [], createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, updates: [], tasks: [], ...partial });
}

describe("taskPrompt 完成判据注入", () => {
  it("判据逐条注入并带自检门槛;无判据不出判据段", () => {
    const withCriteria = project({ tasks: [{ id: "t-1", title: "任务", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [], updates: [], criteria: [{ id: "c-1", text: "pnpm test 全绿" }, { id: "c-2", text: "浏览器目检通过" }] }] });
    const prompt = taskPrompt(withCriteria, withCriteria.tasks[0]);
    expect(prompt).toContain("完成判据(共 2 条");
    expect(prompt).toContain("1. pnpm test 全绿");
    expect(prompt).toContain("2. 浏览器目检通过");
    expect(prompt).toContain("未全过不得进 review");
    const bare = project({ tasks: [{ id: "t-1", title: "任务", status: "todo", owner: "我", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [], updates: [] }] });
    expect(taskPrompt(bare, bare.tasks[0])).not.toContain("完成判据");
  });
});

describe("任务完成判据归一化(normalizeProject → task.criteria)", () => {
  const base = { id: "t-1", title: "任务", status: "todo", order: 0, createdAt: `${TODAY}T00:00:00Z`, updatedAt: `${TODAY}T00:00:00Z`, attachments: [], sessions: [] };
  const normalize = (task: unknown) => normalizeProject({ id: "p-x", name: "项目", tasks: [task] }).tasks[0];

  it("合法保留;空文本滤掉;缺 id 补;无字段(undefined 不造空数组,磁盘最小形)", () => {
    const criteria = normalize({ ...base, criteria: [
      { id: "c-1", text: "测试全绿" },
      { text: "缺 id 自动补" },
      { id: "c-3", text: "" },
      "junk",
    ] }).criteria;
    expect(criteria).toHaveLength(2);
    expect(criteria![0]).toEqual({ id: "c-1", text: "测试全绿" });
    expect(criteria![1].id).toMatch(/^c-/);
    expect(normalize({ ...base }).criteria).toBeUndefined();
  });
});
