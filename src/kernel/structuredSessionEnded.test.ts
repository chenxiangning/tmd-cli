import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 结束 RPC 会话账本契约(关闭存续 + 工作区磁盘行让位判据)。
 * 桩面同 structuredSessionTabs.test.ts:tabs 注册表本地数组,关闭捕获
 * 走 subscribeEditorTabs 订阅(真实 closeTab 语义)。 */

const h = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; kind?: string; title?: string; payload?: unknown }>,
  activeId: null as string | null,
  tabListeners: [] as Array<() => void>,
}));

vi.mock("./tabs", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    getTabs: () => h.tabs,
    getTab: (id: string) => h.tabs.find((t) => t.id === id) ?? null,
    getActiveTabId: () => h.activeId ?? null,
    openTab: vi.fn(),
    setActiveTab: vi.fn(),
    subscribeEditorTabs: (fn: () => void) => {
      h.tabListeners.push(fn);
      return () => {};
    },
  };
});
vi.mock("./host", () => ({ host: { getCliProfile: () => ({ name: "OMP" }) } }));
vi.mock("./workspace", () => ({ getActiveWorkspace: () => undefined, getWorkspaces: () => [] }));
vi.mock("./sessionViewTabs", () => ({
  isSessionViewAvailable: () => true,
  openSessionViewAtText: vi.fn(),
}));
vi.mock("./i18n", () => ({ t: (text: string) => text }));

import { isSsSessionTracked, noteStructuredSessionRow } from "./structuredSessionTabs";
import { dismissClosedSsSession, getClosedSsSessions, noteClosedSsSession } from "./structuredSessionEnded";

const ID = "structured:omp:/repo";

/** 桩注册表开 tab + 触发订阅(payload 可覆写,resume 目标需带判据)。 */
function openInto(id: string, payload?: unknown) {
  h.tabs.push({ id, kind: "structured-session", title: `${id} title`, payload: payload ?? { profileId: "omp", cwd: "/repo" } });
  h.tabListeners.forEach((fn) => fn());
}

/** 桩注册表移除 tab + 触发订阅(真实 closeTab 语义)。 */
function closeInto(id: string) {
  h.tabs = h.tabs.filter((t) => t.id !== id);
  h.tabListeners.forEach((fn) => fn());
}

const clear = () => {
  for (const c of getClosedSsSessions()) dismissClosedSsSession(c.sessionId);
};

beforeEach(() => {
  h.tabs = [];
  h.activeId = null;
  clear();
});
afterEach(clear);

describe("结束会话账本(关闭存续:关 tab 即剔行的投影缺口补偿)", () => {
  it("已握手会话关 tab 即入账(快照 + busy 旗),未握手壳不入账", () => {
    openInto(ID);
    noteStructuredSessionRow(ID, { sessionId: "cli-end-1", busy: true });
    closeInto(ID);
    expect(getClosedSsSessions()).toEqual([
      expect.objectContaining({ profileId: "omp", cwd: "/repo", sessionId: "cli-end-1", busy: true }),
    ]);
    /* 未握手(sessionId null)关闭:无 resume 出口,空壳不存续。 */
    openInto("structured:omp:/repo2");
    closeInto("structured:omp:/repo2");
    expect(getClosedSsSessions().some((c) => c.cwd === "/repo2")).toBe(false);
  });

  it("isSsSessionTracked 三源合流:活行绑定 / resume 目标 / 结束账本;移除后回落 false", () => {
    /* 结束账本源 */
    noteClosedSsSession({ profileId: "omp", cwd: "/repo", sessionId: "cli-t1", title: "旧会话" });
    expect(isSsSessionTracked("cli-t1")).toBe(true);
    /* 活行绑定源 + resume 目标源 */
    openInto(ID);
    noteStructuredSessionRow(ID, { sessionId: "cli-t2" });
    openInto("structured:omp:/repo#cli-t3", { profileId: "omp", cwd: "/repo", resumeSessionId: "cli-t3" });
    expect(isSsSessionTracked("cli-t2")).toBe(true);
    expect(isSsSessionTracked("cli-t3")).toBe(true);
    expect(isSsSessionTracked("cli-其他")).toBe(false);
    /* 移除记录:账本源消失(活行源不受 dismiss 影响) */
    dismissClosedSsSession("cli-t1");
    expect(isSsSessionTracked("cli-t1")).toBe(false);
  });

  it("账本持久化:note 即写 localStorage tmd.ss.closed(重启存续,PTY parity)", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem });
    try {
      noteClosedSsSession({ profileId: "omp", cwd: "/repo", sessionId: "cli-t4", title: "要存续的" });
      expect(setItem).toHaveBeenCalledWith(
        "tmd.ss.closed",
        expect.stringContaining("cli-t4"),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
