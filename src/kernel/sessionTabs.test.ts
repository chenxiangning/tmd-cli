/**
 * 会话标题 tab 条 store 契约测试(kernel/sessionTabs.ts)。
 * 覆盖:打开追加次序 / 重复聚焦稳定位 / 容量挤除最老 / 存活剪除 /
 * 标题快照写入与剪除 / 摘 tab 的活跃指针切换语义 / 非法负载防御。
 * 事件与 host 指针均注入替身,不触真实 host 单例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootSessionTabs, closeAllSessionTabs, closeOtherSessionTabs, closeSessionTab, getSessionBaseline, getSessionTabTitle, getSessionTabs, getSessionTile, noteSessionTabTitle, resetSessionTabsForTest, toggleSessionTile } from "./sessionTabs";
import { updateSettings } from "./settings";
import { SESSION_TABS_LIMIT_DEFAULT } from "./settingsAppearance";
import { EventBus, KernelTopics } from "./events";
import type { SessionMeta } from "./ipc";

const meta = (id: string): SessionMeta => ({ id, profileId: "omp", cwd: "/repo" });

function boot() {
  const events = new EventBus();
  const deps = {
    getActiveSessionId: vi.fn<() => string | null>(() => null),
    setActiveSession: vi.fn<(id: string | null) => void>(),
  };
  bootSessionTabs(events, deps);
  return { events, deps };
}

const open = (events: EventBus, id: string) =>
  events.emit(KernelTopics.activeSessionChanged, id);

beforeEach(() => {
  resetSessionTabsForTest();
  updateSettings({ sessionTabsMax: SESSION_TABS_LIMIT_DEFAULT });
});

describe("打开次序与容量", () => {
  it("新会话追加队尾,重复聚焦保持原位不重排", () => {
    const { events } = boot();
    open(events, "a");
    open(events, "b");
    open(events, "a"); // 聚焦不重排
    open(events, "c");
    expect(getSessionTabs()).toEqual(["a", "b", "c"]);
  });

  it(`超过默认容量 ${SESSION_TABS_LIMIT_DEFAULT} 个挤掉最早打开的 tab`, () => {
    const { events } = boot();
    for (const id of ["a", "b", "c", "d"]) open(events, id);
    open(events, "e");
    expect(getSessionTabs()).toEqual(["b", "c", "d", "e"]);
    open(events, "f");
    expect(getSessionTabs()).toEqual(["c", "d", "e", "f"]);
  });

  it("容量随设置缩小时即时修剪,保留最近打开;后续打开按新容量挤除", () => {
    const { events } = boot();
    for (const id of ["a", "b", "c", "d"]) open(events, id);
    updateSettings({ sessionTabsMax: 2 });
    expect(getSessionTabs()).toEqual(["c", "d"]);
    open(events, "e");
    expect(getSessionTabs()).toEqual(["d", "e"]);
  });

  it("回到首页(null)与非法负载不动 tab", () => {
    const { events } = boot();
    open(events, "a");
    events.emit(KernelTopics.activeSessionChanged, null);
    events.emit(KernelTopics.activeSessionChanged, "");
    events.emit(KernelTopics.activeSessionChanged, 42);
    expect(getSessionTabs()).toEqual(["a"]);
  });
});

describe("存活剪除", () => {
  it("sessionsChanged 剪掉已消失的 tab,标题快照一并清", () => {
    const { events } = boot();
    open(events, "a");
    open(events, "b");
    noteSessionTabTitle("a", "标题甲");
    events.emit(KernelTopics.sessionsChanged, [meta("b")]);
    expect(getSessionTabs()).toEqual(["b"]);
    expect(getSessionTabTitle("a")).toBeUndefined();
  });
});

describe("标题快照", () => {
  it("写入后可读,空串/纯空白忽略,同值不空转通知", () => {
    const { events } = boot();
    open(events, "a");
    noteSessionTabTitle("a", "  标题  ");
    expect(getSessionTabTitle("a")).toBe("标题");
    noteSessionTabTitle("a", "   ");
    expect(getSessionTabTitle("a")).toBe("标题");
    const before = getSessionTabs();
    noteSessionTabTitle("a", "标题");
    expect(getSessionTabs()).toBe(before); // 同值:快照引用不变(不触发重渲染)
  });
});

describe("摘 tab 语义", () => {
  it("摘活跃 tab → 切到剩余最近打开的一个", () => {
    const { events, deps } = boot();
    for (const id of ["a", "b", "c"]) open(events, id);
    deps.getActiveSessionId.mockReturnValue("c");
    closeSessionTab("c");
    expect(getSessionTabs()).toEqual(["a", "b"]);
    expect(deps.setActiveSession).toHaveBeenCalledWith("b");
  });

  it("摘非活跃 tab 不动指针;摘尽回 welcome(null)", () => {
    const { events, deps } = boot();
    open(events, "a");
    open(events, "b");
    deps.getActiveSessionId.mockReturnValue("b");
    closeSessionTab("a");
    expect(deps.setActiveSession).not.toHaveBeenCalled();
    expect(getSessionTabs()).toEqual(["b"]);
    closeSessionTab("b");
    expect(deps.setActiveSession).toHaveBeenCalledWith(null);
  });

  it("摘不存在的 tab 是静默空操作", () => {
    const { deps } = boot();
    closeSessionTab("ghost");
    expect(deps.setActiveSession).not.toHaveBeenCalled();
  });
});

describe("批量摘 tab(右键菜单)", () => {
  it("关闭其他:只留目标;活跃 tab 被摘时指针切到保留 id", () => {
    const { events, deps } = boot();
    for (const id of ["a", "b", "c"]) open(events, id);
    deps.getActiveSessionId.mockReturnValue("b");
    closeOtherSessionTabs("c");
    expect(getSessionTabs()).toEqual(["c"]);
    expect(deps.setActiveSession).toHaveBeenCalledWith("c");
  });

  it("关闭其他:目标即活跃时不动指针;仅剩一个时整体无操作", () => {
    const { events, deps } = boot();
    open(events, "a");
    open(events, "b");
    deps.getActiveSessionId.mockReturnValue("b");
    closeOtherSessionTabs("b");
    expect(getSessionTabs()).toEqual(["b"]);
    expect(deps.setActiveSession).not.toHaveBeenCalled();
    closeOtherSessionTabs("b");
    expect(getSessionTabs()).toEqual(["b"]);
    expect(deps.setActiveSession).not.toHaveBeenCalled();
  });

  it("关闭其他:目标不在条内是静默空操作", () => {
    const { events, deps } = boot();
    open(events, "a");
    closeOtherSessionTabs("ghost");
    expect(getSessionTabs()).toEqual(["a"]);
    expect(deps.setActiveSession).not.toHaveBeenCalled();
  });

  it("关闭全部:摘尽且活跃指针置 null 回 welcome", () => {
    const { events, deps } = boot();
    open(events, "a");
    open(events, "b");
    deps.getActiveSessionId.mockReturnValue("a");
    closeAllSessionTabs();
    expect(getSessionTabs()).toEqual([]);
    expect(deps.setActiveSession).toHaveBeenCalledWith(null);
  });
});

describe("首条用户消息保底", () => {
  it("promptSent 即时上屏:tab 快照与行保底同源,取首行去 \r", () => {
    const { events } = boot();
    open(events, "a");
    events.emit(KernelTopics.promptSent, { sessionId: "a", text: "帮我看看这个性能问题\r\n第二行" });
    expect(getSessionTabTitle("a")).toBe("帮我看看这个性能问题");
    expect(getSessionBaseline("a")).toBe("帮我看看这个性能问题");
  });

  it("斜杠命令与空文本不采集", () => {
    const { events } = boot();
    open(events, "a");
    events.emit(KernelTopics.promptSent, { sessionId: "a", text: "/compact" });
    events.emit(KernelTopics.promptSent, { sessionId: "b", text: " \r\n  " });
    expect(getSessionBaseline("a")).toBeUndefined();
    expect(getSessionBaseline("b")).toBeUndefined();
    expect(getSessionTabTitle("a")).toBeUndefined();
  });

  it("已有真快照不覆盖;AI 标题后到回喂仍覆盖保底快照", () => {
    const { events } = boot();
    open(events, "a");
    noteSessionTabTitle("a", "磁盘真标题");
    events.emit(KernelTopics.promptSent, { sessionId: "a", text: "新消息" });
    expect(getSessionTabTitle("a")).toBe("磁盘真标题");
    expect(getSessionBaseline("a")).toBeUndefined();
    noteSessionTabTitle("a", "AI 智能标题");
    expect(getSessionTabTitle("a")).toBe("AI 智能标题");
  });

  it("短码形态拒收为快照(行点击兜底历史喂入的垃圾)", () => {
    noteSessionTabTitle("a", "18d3…e414");
    expect(getSessionTabTitle("a")).toBeUndefined();
  });

  it("会话剪除连保底一起清", () => {
    const { events } = boot();
    open(events, "a");
    events.emit(KernelTopics.promptSent, { sessionId: "a", text: "标题" });
    events.emit(KernelTopics.sessionsChanged, []);
    expect(getSessionBaseline("a")).toBeUndefined();
    expect(getSessionTabTitle("a")).toBeUndefined();
  });
});

describe("平铺显示开关", () => {
  it("toggle 双态翻转;ids 不受影响", () => {
    const { events } = boot();
    open(events, "a");
    expect(getSessionTile()).toBe(false);
    toggleSessionTile();
    expect(getSessionTile()).toBe(true);
    toggleSessionTile();
    expect(getSessionTile()).toBe(false);
    expect(getSessionTabs()).toEqual(["a"]);
  });

  it("reset 复位为关", () => {
    toggleSessionTile();
    expect(getSessionTile()).toBe(true);
    resetSessionTabsForTest();
    expect(getSessionTile()).toBe(false);
  });
});
