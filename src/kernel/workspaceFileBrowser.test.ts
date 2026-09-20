import { describe, expect, it, vi } from "vitest";
import type { ComponentType } from "react";
import {
  closeWorkspaceFiles,
  getWorkspaceFileBrowserOpenId,
  getWorkspaceFileBrowserView,
  openWorkspaceFiles,
  registerWorkspaceFileBrowser,
  subscribe,
} from "./workspaceFileBrowser";

import type { WorkspaceFileBrowserProps } from "./workspaceFileBrowser";

function fakeView(): ComponentType<WorkspaceFileBrowserProps> {
  return () => null;
}

describe("workspaceFileBrowser 契约", () => {
  it("实现未注册时 open 是 no-op,不产生开态", () => {
    registerWorkspaceFileBrowser(null);
    openWorkspaceFiles("ws1");
    expect(getWorkspaceFileBrowserOpenId()).toBe(null);
  });

  it("注册后 open 记录工作区 id,再开另一个即切换;close 归 null", () => {
    const view = fakeView();
    registerWorkspaceFileBrowser(view);
    openWorkspaceFiles("ws1");
    expect(getWorkspaceFileBrowserOpenId()).toBe("ws1");
    expect(getWorkspaceFileBrowserView()).toBe(view);
    openWorkspaceFiles("ws2");
    expect(getWorkspaceFileBrowserOpenId()).toBe("ws2");
    closeWorkspaceFiles();
    expect(getWorkspaceFileBrowserOpenId()).toBe(null);
  });

  it("重复 close 与关后再开都安全", () => {
    registerWorkspaceFileBrowser(fakeView());
    closeWorkspaceFiles();
    expect(getWorkspaceFileBrowserOpenId()).toBe(null);
    openWorkspaceFiles("ws1");
    closeWorkspaceFiles();
    closeWorkspaceFiles();
    expect(getWorkspaceFileBrowserOpenId()).toBe(null);
  });

  it("摘除实现(null)即关闭已开视图", () => {
    registerWorkspaceFileBrowser(fakeView());
    openWorkspaceFiles("ws1");
    registerWorkspaceFileBrowser(null);
    expect(getWorkspaceFileBrowserOpenId()).toBe(null);
    expect(getWorkspaceFileBrowserView()).toBe(null);
  });

  it("开合变化通知订阅者,退订后不再通知", () => {
    const spy = vi.fn();
    const unsub = subscribe(spy);
    registerWorkspaceFileBrowser(fakeView());
    openWorkspaceFiles("ws1");
    closeWorkspaceFiles();
    const calls = spy.mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(3);
    unsub();
    openWorkspaceFiles("ws1");
    expect(spy.mock.calls.length).toBe(calls);
    closeWorkspaceFiles();
  });
});
