/**
 * 任务验收区渲染契约(react-dom/server 静态渲染,模式同 JournalTab.test.tsx):
 * - 判据清单:有判据出列表;无判据不渲染;
 * - review 态验收区:通过收口/驳回回灌按钮 + 意见框;判据作为对照面一并出现。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProjectTask } from "../types";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("@kernel/host", () => ({ host: {} }));
vi.mock("@kernel/profileSend", () => ({ prepareSendPayload: (_p: unknown, text: string) => text }));

import { TaskAcceptanceSec, TaskCriteriaSec } from "../TaskAcceptanceSec";

const T0 = "2026-11-06T00:00:00Z";
const task = (partial: Partial<ProjectTask>): ProjectTask => ({
  id: "t-1", title: "闭环一期", status: "review", order: 0, createdAt: T0, updatedAt: T0,
  attachments: [], sessions: [], updates: [],
  criteria: [{ id: "c-1", text: "pnpm test 全绿" }, { id: "c-2", text: "浏览器目检" }],
  ...partial,
});

describe("TaskCriteriaSec(判据清单)", () => {
  it("逐条渲染;无判据整节不出现", () => {
    const html = renderToStaticMarkup(createElement(TaskCriteriaSec, { task: task({}) }));
    expect(html).toContain("完成判据");
    expect(html).toContain("pnpm test 全绿");
    expect(html).toContain("浏览器目检");
    expect(renderToStaticMarkup(createElement(TaskCriteriaSec, { task: task({ criteria: undefined }) }))).toBe("");
  });
});

describe("TaskAcceptanceSec(review 态验收 gate)", () => {
  it("通过收口与驳回回灌按钮 + 意见框齐备", () => {
    const html = renderToStaticMarkup(createElement(TaskAcceptanceSec, { task: task({}), onToast: () => {}, onStatus: () => {} }));
    expect(html).toContain("验收");
    expect(html).toContain("通过并收口");
    expect(html).toContain("驳回并回灌会话");
    expect(html).toContain("驳回意见(必填,回灌给关联会话续跑)");
  });
});
