import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 桩面:kernel 依赖最小化(tabs 注册表本地数组;host/workspace/viewer/i18n 全桩)。 */
const h = vi.hoisted(() => ({
  tabs: [] as Array<{ id: string; kind?: string; title?: string; payload?: unknown }>,
  activeId: null as string | null,
  tabListeners: [] as Array<() => void>,
  viewerAvailable: true,
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  openView: vi.fn(),
}));

vi.mock("./tabs", async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    getTabs: () => h.tabs,
    getTab: (id: string) => h.tabs.find((t) => t.id === id) ?? null,
    getActiveTabId: () => h.activeId ?? null,
    openTab: h.openTab,
    setActiveTab: h.setActiveTab,
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
  getStructuredSessionRows,
  noteStructuredSessionRow,
  openStructuredSessionTab,
  openStructuredSessionTranscript,
  structuredSessionTarget,
  focusStructuredSessionTab,
  noteSsRpcSession,
  isSsRpcSession,
} from "./structuredSessionTabs";
import { getActiveRpcEvidenceView } from "./structuredSessionEvidence";

const TARGET = { profileId: "omp", cwd: "/repo" };

/** 桩注册表 openTab 落数组 + 手动触发订阅(真实 store 里 commit 自动通知)。
 *  payload 可覆写(resume 目标 tab 需带 resumeSessionId 判据)。 */
function openInto(id: string, kind = "structured-session", payload?: unknown) {
  h.tabs.push({ id, kind, title: `${id} title`, payload: payload ?? { profileId: "omp", cwd: "/repo" } });
  h.tabListeners.forEach((fn) => fn());
}

beforeEach(() => {
  h.tabs = [];
  h.activeId = null;
  h.viewerAvailable = true;
  vi.clearAllMocks();
  /* 行态快照重置:关全部 tab(剔行 + 清孤儿态)还原干净基线。 */
  h.tabListeners.forEach((fn) => fn());
});

describe("未读记账(批次 2:结算沿累加,激活即读)", () => {
  const ID = "structured:omp:/repo";

  it("结算沿累加未读;激活该 tab 即清零,别的 tab 激活不误清", () => {
    openInto(ID);
    noteStructuredSessionRow(ID, { unread: 1 });
    expect(getStructuredSessionRows()[0].unread).toBe(1);

    /* 再一轮结算 → 累加(组件侧语义:note 传 prev+1,kernel 只存)。 */
    noteStructuredSessionRow(ID, { unread: 2 });
    expect(getStructuredSessionRows()[0].unread).toBe(2);

    /* 激活 tab → 订阅出口清零(setActiveTab 单一出口)。 */
    h.activeId = ID;
    h.tabListeners.forEach((fn) => fn());
    expect(getStructuredSessionRows()[0].unread).toBe(0);

    /* 非激活 tab 的未读不被别的 tab 激活误清。 */
    noteStructuredSessionRow(ID, { unread: 1 });
    h.activeId = "other-tab";
    h.tabListeners.forEach((fn) => fn());
    expect(getStructuredSessionRows()[0].unread).toBe(1);
  });
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

  it("resume 重开叠会话判别后缀:同引擎同 cwd 可并行多个 RPC 会话", () => {
    openStructuredSessionTab("omp", "/repo", { resumeSessionId: "cli-1" });
    expect(h.openTab).toHaveBeenCalledWith(
      expect.objectContaining({ id: "structured:omp:/repo#cli-1" }),
    );
    /* 再点另一盘 = 另一个 id(并行);同盘再点 = 同 id(注册表去重为激活,
       本桩不模拟注册表,只验证调用方身份口径)。 */
    openStructuredSessionTab("omp", "/repo", { resumeSessionId: "cli-2" });
    expect(h.openTab).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "structured:omp:/repo#cli-2" }),
    );
    openStructuredSessionTab("omp", "/repo", { resumeSessionId: "cli-1" });
    expect(h.openTab).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "structured:omp:/repo#cli-1" }),
    );
  });

  it("cwd 含 #/% 时 id 段转义:后缀判别不歧义,target 解析还原原 cwd", () => {
    openStructuredSessionTab("omp", "/re#po", { resumeSessionId: "cli-1" });
    const id = h.openTab.mock.calls.at(-1)?.[0]?.id;
    expect(id).toBe("structured:omp:/re%23po#cli-1"); /* cwd 的 # 已转义,尾部 # 恒为后缀 */
    expect(structuredSessionTarget(id)).toEqual({ profileId: "omp", cwd: "/re#po" });
    expect(structuredSessionTarget("structured:omp:/a%25b")).toEqual({ profileId: "omp", cwd: "/a%b" });
  });

  it("通知深链按原 tab id 精确激活;已关则 #sid resume 重开,base id 账本回落,全无才开新", () => {
    openInto("structured:omp:/repo#cli-9");
    focusStructuredSessionTab("structured:omp:/repo#cli-9", "omp", "/repo");
    expect(h.setActiveTab).toHaveBeenCalledWith("structured:omp:/repo#cli-9");
    expect(h.openTab).not.toHaveBeenCalled();
    h.tabs = [];
    focusStructuredSessionTab("structured:omp:/repo#cli-9", "omp", "/repo");
    expect(h.openTab).toHaveBeenCalledWith(expect.objectContaining({ id: "structured:omp:/repo#cli-9" }));
    h.openTab.mockClear();
    /* base id + 结束账本空(node 无 localStorage)→ 全新会话兜底。 */
    focusStructuredSessionTab("structured:omp:/repo", "omp", "/repo");
    expect(h.openTab).toHaveBeenCalledWith(expect.objectContaining({ id: "structured:omp:/repo" }));
  });
});

describe("structured 历史深链", () => {
  it("精确 #sid 活 tab 命中 → jumped,不开查看器", () => {
    openInto("structured:omp:/repo#cli-1");
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("jumped");
    expect(h.openTab).toHaveBeenCalledOnce();
    expect(h.openView).not.toHaveBeenCalled();
  });

  it("base tab(reload 收养无后缀)行投影 sid 即目标 → 同样 jumped", () => {
    openInto("structured:omp:/repo");
    noteStructuredSessionRow("structured:omp:/repo", { sessionId: "cli-1" });
    expect(openStructuredSessionTranscript(TARGET, "cli-1", "原任务", 2)).toBe("jumped");
    expect(h.openView).not.toHaveBeenCalled();
  });

  it("base tab 是别的会话 → 不假报 jumped,落原 CLI 磁盘转录定位(B2)", () => {
    openInto("structured:omp:/repo");
    noteStructuredSessionRow("structured:omp:/repo", { sessionId: "cli-8" });
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

  it("resume 判别后缀(# 段)解析时剥除:存证/收养只认引擎 + cwd 二维", () => {
    expect(structuredSessionTarget("structured:omp:/repo#cli-1")).toEqual(TARGET);
    expect(structuredSessionTarget("structured:omp:/repo#")).toEqual(TARGET);
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

describe("RPC 会话身份记忆(工作区入口区分:R-ISO1 行徽标判据)", () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("登记后可识别,未登记为 false;重复登记不膨胀", () => {
    noteSsRpcSession("cli-a");
    noteSsRpcSession("cli-b");
    noteSsRpcSession("cli-a");
    expect(isSsRpcSession("cli-a")).toBe(true);
    expect(isSsRpcSession("cli-b")).toBe(true);
    expect(isSsRpcSession("cli-z")).toBe(false);
    expect(JSON.parse(localStorage.getItem("tmd.ss.rpcids") ?? "[]")).toHaveLength(2);
  });

  it("滚动封顶 200:最旧被挤出,最新恒在", () => {
    noteSsRpcSession("old");
    for (let i = 0; i < 210; i++) noteSsRpcSession(`s${i}`);
    expect(isSsRpcSession("old")).toBe(false);
    expect(isSsRpcSession("s209")).toBe(true);
  });

  it("存储损坏/缺失降级 false,不抛", () => {
    localStorage.setItem("tmd.ss.rpcids", "{broken");
    expect(isSsRpcSession("any")).toBe(false);
    noteSsRpcSession("cli-x"); /* 损坏值上重写自愈 */
    expect(isSsRpcSession("cli-x")).toBe(true);
  });
});

describe("活跃 RPC 存证视角(处理插件对接:审批线/时间线)", () => {
  const ID = "structured:omp:/repo";

  it("活跃 structured tab 出视角:tabId/cwd 取 tab,引擎 sid 取行态广播", () => {
    openInto(ID);
    h.activeId = ID;
    expect(getActiveRpcEvidenceView()).toMatchObject({
      tabId: ID,
      profileId: "omp",
      cwd: "/repo",
      engineSessionId: null,
      userTexts: [],
    });
    /* 行态广播后引擎 sid 与用户文本流随视角读出(时间线直读)。 */
    noteStructuredSessionRow(ID, { sessionId: "cli-1", userTexts: ["第一条", "第二条"] });
    expect(getActiveRpcEvidenceView()).toMatchObject({
      engineSessionId: "cli-1",
      userTexts: ["第一条", "第二条"],
    });
  });

  it("活跃 tab 非 structured / 无活跃 tab → null(PTY 视角不被劫持)", () => {
    openInto(ID);
    h.activeId = null;
    expect(getActiveRpcEvidenceView()).toBeNull();
    openInto("editor-x", "editor");
    h.activeId = "editor-x";
    expect(getActiveRpcEvidenceView()).toBeNull();
  });
});
