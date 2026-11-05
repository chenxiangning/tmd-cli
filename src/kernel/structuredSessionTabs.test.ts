import { beforeEach, describe, expect, it, vi } from "vitest";

/* 桩面:kernel 依赖最小化(tabs 注册表本地数组;host/workspace/viewer/i18n 全桩)。 */
const h = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; kind?: string; title?: string; payload?: unknown }>,
  tabListeners: [] as Array<() => void>,
  viewerAvailable: true,
  openTab: vi.fn(),
  openView: vi.fn(),
}));

vi.mock("./tabs", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    getTabs: () => h.tabs,
    getTab: (id: string) => h.tabs.find((t) => t.id === id) ?? null,
    openTab: h.openTab,
    subscribeEditorTabs: (fn: () => void) => {
      h.tabListeners.push(fn);
      return () => {};
    },
  };
});
vi.mock("./host", () => ({ host: { getCliProfile: () => ({ name: "OMP" }) } }));
vi.mock("./workspace", () => ({
  getActiveWorkspace: () => undefined,
  getWorkspaces: () => [],
}));
vi.mock("./sessionViewTabs", () => ({
  isSessionViewAvailable: () => h.viewerAvailable,
  openSessionViewAtText: h.openView,
}));
vi.mock("./i18n", () => ({ t: (text: string) => text }));

import {
  noteStructuredSessionRow,
  openStructuredSessionTab,
  openStructuredSessionTranscript,
  structuredSessionTarget,
  getStructuredSessionRows,
} from "./structuredSessionTabs";

const TARGET = { profileId: "omp", cwd: "/repo" };

/** 桩注册表 openTab 落数组 + 手动触发订阅(真实 store 里 commit 自动通知)。 */
function openInto(id: string, kind = "structured-session") {
  h.tabs.push({ id, kind, title: `${id} title`, payload: { profileId: "omp", cwd: "/repo" } });
  h.tabListeners.forEach((fn) => fn());
}

beforeEach(() => {
  h.tabs = [];
  h.viewerAvailable = true;
  vi.clearAllMocks();
  /* 行态快照重置:关全部 tab(剔行 + 清孤儿态)还原干净基线。 */
  h.tabListeners.forEach((fn) => fn());
});

describe("G-02 openStructuredSessionTab 身份", () => {
  it("tab id 以 structured: 前缀命名、标题带「带渲染的会话」(与 PTY 会话身份隔离)", () => {
    openStructuredSessionTab("omp", "/repo");
    expect(h.openTab).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "structured:omp:/repo",
        kind: "structured-session",
        title: "OMP · 带渲染的会话",
      }),
    );
  });
});

describe("structured 历史深链", () => {
  it("原 structured tab 仍在时激活现有转录", () => {
    h.tabs = [{ id: "structured:omp:/repo" }];
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("jumped");
    expect(h.openTab).toHaveBeenCalledOnce();
    expect(h.openView).not.toHaveBeenCalled();
  });

  it("原 tab 已关闭时打开原 CLI 磁盘转录,不新起空 RPC", () => {
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("opened");
    expect(h.openTab).not.toHaveBeenCalled();
    expect(h.openView).toHaveBeenCalledWith(
      { profileId: "omp", cwd: "/repo", cliSessionId: "cli-1" },
      "原任务",
      2,
    );
  });

  it("账本副键:structured: 前缀解析回 payload,PTY 身份返回 null", () => {
    expect(structuredSessionTarget("structured:omp:/repo")).toEqual(TARGET);
    expect(structuredSessionTarget("structured:omp:")).toBeNull();
    expect(structuredSessionTarget("pty-3")).toBeNull();
    expect(structuredSessionTarget(undefined)).toBeNull();
  });
});

describe("左栏行投影(批次 1:tab 生命周期即行生命周期)", () => {
  it("tab open 即出行(缺省 starting 态);广播 patch 覆盖运行态", () => {
    openInto("structured:omp:/repo");
    let rows = getStructuredSessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tabId: "structured:omp:/repo", phase: "starting", busy: false });

    noteStructuredSessionRow("structured:omp:/repo", { phase: "ready", busy: true, busySince: 123 });
    rows = getStructuredSessionRows();
    expect(rows[0]).toMatchObject({ phase: "ready", busy: true, busySince: 123, waitingConfirm: false });

    /* patch 合并:未覆盖字段保留广播值。 */
    noteStructuredSessionRow("structured:omp:/repo", { busy: false, busySince: null });
    rows = getStructuredSessionRows();
    expect(rows[0]).toMatchObject({ phase: "ready", busy: false });
  });

  it("tab 关闭即剔行(editorTabs 订阅驱动,无孤儿行)", () => {
    openInto("structured:omp:/repo");
    noteStructuredSessionRow("structured:omp:/repo", { phase: "ready" });
    h.tabs = [];
    h.tabListeners.forEach((fn) => fn());
    expect(getStructuredSessionRows()).toHaveLength(0);
    /* 孤儿运行态随行清理,同名新 tab 不吃旧态。 */
    openInto("structured:omp:/repo");
    expect(getStructuredSessionRows()[0]).toMatchObject({ phase: "starting" });
  });

  it("非 structured kind 的 tab 不出行;广播到不存在的 tab 被忽略", () => {
    openInto("session-view:omp:cli-1", "session-view");
    expect(getStructuredSessionRows()).toHaveLength(0);
    noteStructuredSessionRow("structured:omp:/gone", { phase: "ready" });
    expect(getStructuredSessionRows()).toHaveLength(0);
  });
});
