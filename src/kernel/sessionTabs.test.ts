/**
 * 会话标题 tab 条 store 契约测试(kernel/sessionTabs.ts)。
 * 覆盖:打开追加次序 / 重复聚焦稳定位 / 容量挤除最老 / 存活剪除 /
 * 标题快照写入与剪除 / 摘 tab 的活跃指针切换语义 / 非法负载防御。
 * 事件与 host 指针均注入替身,不触真实 host 单例。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootSessionTabs, closeSessionTab, getSessionTabTitle, getSessionTabs, noteSessionTabTitle, resetSessionTabsForTest, SESSION_TABS_MAX } from "./sessionTabs";
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

beforeEach(() => resetSessionTabsForTest());

describe("打开次序与容量", () => {
  it("新会话追加队尾,重复聚焦保持原位不重排", () => {
    const { events } = boot();
    open(events, "a");
    open(events, "b");
    open(events, "a"); // 聚焦不重排
    open(events, "c");
    expect(getSessionTabs()).toEqual(["a", "b", "c"]);
  });

  it(`超过 ${SESSION_TABS_MAX} 个挤掉最早打开的 tab`, () => {
    const { events } = boot();
    for (const id of ["a", "b", "c", "d"]) open(events, id);
    open(events, "e");
    expect(getSessionTabs()).toEqual(["b", "c", "d", "e"]);
    open(events, "f");
    expect(getSessionTabs()).toEqual(["c", "d", "e", "f"]);
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
