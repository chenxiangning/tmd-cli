/**
 * 新建意图排队回归:消灭工作区切换菜单「新建文件/文件夹」的 400ms 定时器
 * 赌重挂时序(2026-10-06)。契约:树在则立即执行;不在则排队,挂载注册即
 * 消费,TTL 10s 内有效。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestTreeNew, setActiveTreeHandles } from "./treeHandles";

function fakeHandles() {
  return {
    reload: vi.fn(async () => {}),
    newFile: vi.fn(),
    newFolder: vi.fn(),
  };
}

describe("treeHandles 新建意图排队", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
    setActiveTreeHandles(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveTreeHandles(null);
  });

  it("树在:请求立即执行不入队", () => {
    const h = fakeHandles();
    setActiveTreeHandles(h);
    requestTreeNew("newFile");
    expect(h.newFile).toHaveBeenCalledTimes(1);
    /* 再挂载(重挂)不重复弹 —— 没排过队。 */
    setActiveTreeHandles(fakeHandles());
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });

  it("树不在:意图排队,挂载注册即消费", () => {
    requestTreeNew("newFolder");
    const h = fakeHandles();
    setActiveTreeHandles(h);
    expect(h.newFolder).toHaveBeenCalledTimes(1);
    /* 意图一次性:二次挂载不重复弹。 */
    setActiveTreeHandles(null);
    const h2 = fakeHandles();
    setActiveTreeHandles(h2);
    expect(h2.newFolder).not.toHaveBeenCalled();
  });

  it("意图过期(>10s)挂载即丢弃", () => {
    requestTreeNew("newFile");
    vi.advanceTimersByTime(10_001);
    const h = fakeHandles();
    setActiveTreeHandles(h);
    expect(h.newFile).not.toHaveBeenCalled();
  });

  it("卸载置 null 不消费;排队意图由下次注册消费", () => {
    requestTreeNew("newFile");
    setActiveTreeHandles(null);
    const h = fakeHandles();
    setActiveTreeHandles(h);
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });

  it("同类意图覆盖旧意图(连点只弹一次)", () => {
    requestTreeNew("newFile");
    requestTreeNew("newFile");
    const h = fakeHandles();
    setActiveTreeHandles(h);
    expect(h.newFile).toHaveBeenCalledTimes(1);
  });
});
