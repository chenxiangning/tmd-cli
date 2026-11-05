import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/* StructuredSessionSection 装配契约:
 * 1. 结束存续行(2026-11-05 关闭列表消失修复):活行 + 结束账本行同分区渲染;
 *    活行认领(同 sessionId)的记录隐藏;计数含存续行。
 * 2. 工作区归属(2026-11-05 图 2 结构定稿):带 workspace prop 只渲染
 *    cwd === workspace.root 的行/账本;无 prop = 孤儿兜底,只渲染 cwd 不
 *    属于任何在册工作区的行,常态为空串。 */

const h = vi.hoisted(() => ({
  rows: [] as Array<{ tabId: string; profileId: string; cwd: string; title: string; sessionId: string | null; busy: boolean; busySince: null; waitingConfirm: boolean; unread: number; userTexts: string[]; phase: string }>,
  closed: [] as Array<{ profileId: string; cwd: string; sessionId: string; title: string; closedAt: number }>,
  workspaces: [] as Array<{ id: string; name: string; root: string; createdAt: number }>,
}));

vi.mock("@kernel/i18n", () => ({ t: (text: string) => text }));
vi.mock("@kernel/host", () => ({
  host: { getCliProfile: () => ({ name: "OMP", renderIcon: () => null }) },
  useHost: () => undefined,
}));
vi.mock("@kernel/tabs", () => ({
  closeTab: vi.fn(),
  setActiveTab: vi.fn(),
  updateTab: vi.fn(),
  useEditorTabs: () => ({ activeId: null }),
}));
vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => h.workspaces,
  useWorkspaces: () => ({ list: h.workspaces, activeId: null }),
}));
vi.mock("@kernel/structuredSessionTabs", () => ({
  useStructuredSessionRows: () => h.rows,
  noteSsTitleOverride: vi.fn(),
  readSsTitleOverride: () => null,
  isSsMuted: () => false,
  toggleSsMute: vi.fn(),
  openStructuredSessionTab: vi.fn(),
}));
vi.mock("@kernel/structuredSessionEnded", () => ({
  useClosedSsSessions: () => h.closed,
  dismissClosedSsSession: vi.fn(),
}));
vi.mock("@kernel/DialogShell", () => ({ useEscClose: () => undefined }));
vi.mock("@kernel/RenameInput", () => ({ RenameInput: () => null }));

import { StructuredSessionSection } from "./StructuredSessionSection";

function row(tabId: string, sessionId: string | null, cwd = "/repo") {
  return {
    tabId, profileId: "omp", cwd, title: `标题-${tabId}`, sessionId,
    busy: false, busySince: null, waitingConfirm: false, unread: 0, userTexts: [], phase: "ready",
  };
}

const ws = { id: "ws1", name: "repo", root: "/repo", createdAt: 1 };

beforeEach(() => {
  h.rows = [];
  h.closed = [];
  h.workspaces = [ws];
});
afterEach(() => {
  h.rows = [];
  h.closed = [];
  h.workspaces = [];
});

describe("带渲染的会话分区(结束存续行装配)", () => {
  it("活行与结束存续行同分区渲染,存续行带「已结束」尾签;计数 = 活行 + 存续行", () => {
    h.rows = [row("t1", "cli-1")];
    h.closed = [{ profileId: "omp", cwd: "/repo", sessionId: "cli-2", title: "旧会话", closedAt: 1 }];
    const html = renderToStaticMarkup(createElement(StructuredSessionSection, { workspace: ws }));
    expect(html).toContain("标题-t1");
    expect(html).toContain("旧会话");
    expect(html).toContain("已结束");
    expect(html).toContain("· 2");
  });

  it("活行认领(同 sessionId)的结束记录隐藏,不双行;全空分区不渲染", () => {
    h.rows = [row("t1", "cli-2")];
    h.closed = [{ profileId: "omp", cwd: "/repo", sessionId: "cli-2", title: "被认领", closedAt: 1 }];
    let html = renderToStaticMarkup(createElement(StructuredSessionSection, { workspace: ws }));
    expect(html).not.toContain("被认领");
    expect(html).toContain("· 1");
    /* resume 目标认领(握手期 sessionId 尚空,按 tab id # 后缀判)同样隐藏。 */
    h.rows = [row("structured:omp:/repo#cli-2", null)];
    html = renderToStaticMarkup(createElement(StructuredSessionSection, { workspace: ws }));
    expect(html).not.toContain("被认领");
    /* 活行与账本全空 → 分区返回 null */
    h.rows = [];
    h.closed = [];
    html = renderToStaticMarkup(createElement(StructuredSessionSection, { workspace: ws }));
    expect(html).toBe("");
  });
});

describe("带渲染的会话分区(工作区归属过滤)", () => {
  it("带 prop 只渲染 cwd 匹配本工作区的行与其他工作区的行不混入", () => {
    h.rows = [row("t1", "cli-1"), row("t2", "cli-2", "/other")];
    h.closed = [{ profileId: "omp", cwd: "/other", sessionId: "cli-3", title: "别区账本", closedAt: 1 }];
    const html = renderToStaticMarkup(createElement(StructuredSessionSection, { workspace: ws }));
    expect(html).toContain("标题-t1");
    expect(html).not.toContain("标题-t2");
    expect(html).not.toContain("别区账本");
    expect(html).toContain("· 1");
  });

  it("无 prop = 孤儿兜底:只渲染 cwd 不属于任何在册工作区的行;有归属即空串", () => {
    h.rows = [row("t1", "cli-1"), row("t2", "cli-2", "/gone-ws")];
    let html = renderToStaticMarkup(createElement(StructuredSessionSection));
    expect(html).not.toContain("标题-t1");
    expect(html).toContain("标题-t2");
    h.rows = [row("t1", "cli-1")];
    html = renderToStaticMarkup(createElement(StructuredSessionSection));
    expect(html).toBe("");
  });
});
