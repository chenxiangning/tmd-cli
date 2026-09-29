/**
 * 抽屉开合/落位 store 状态机契约测试(spec 2026-09-28 P1-3 三路径 + 悬留防护)。
 * 守护:已开换区即时生效(绕早退)、同区再点关闭、任何关闭清意图、
 * 打开复位 resolved(回落裁决只认本次打开的解析终拍)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDrawerSection,
  getDrawerResolved,
  getDrawerSection,
  isDrawerOpen,
  setDrawerOpen,
  setDrawerResolved,
  subscribe,
  toggleDrawerSection,
} from "./drawerOpen";

describe("drawerOpen 状态机", () => {
  beforeEach(() => {
    setDrawerOpen(false);
  });

  it("关→开带分区:open 置真、意图落分区、resolved 复位", () => {
    setDrawerResolved(true); // 上次打开遗留
    toggleDrawerSection("skill");
    expect(isDrawerOpen()).toBe(true);
    expect(getDrawerSection()).toBe("skill");
    expect(getDrawerResolved()).toBe(false); // 图标开帧路径(:68)同样复位
  });

  it("关→开复位 resolved:回落裁决只认本次打开的解析终拍(P0-1)", () => {
    setDrawerOpen(true);
    setDrawerResolved(true); // 动态到达
    expect(getDrawerResolved()).toBe(true);
    setDrawerOpen(false);
    setDrawerOpen(true); // 重开必须回到未解析
    expect(getDrawerResolved()).toBe(false);
  });

  it("已开@skill 点 mcp:保持开、意图即时换、订阅者收到通知(绕 open===next 早退)", () => {
    toggleDrawerSection("skill");
    applyDrawerSection("skill"); // 抽屉落位镜像
    const notify = vi.fn();
    const off = subscribe(notify);
    toggleDrawerSection("mcp");
    expect(isDrawerOpen()).toBe(true);
    expect(getDrawerSection()).toBe("mcp");
    expect(notify).toHaveBeenCalledOnce();
    off();
  });

  it("已开@该区再点 = 关闭(对齐 ⌘K toggle 惯例)", () => {
    toggleDrawerSection("mcp");
    toggleDrawerSection("mcp");
    expect(isDrawerOpen()).toBe(false);
    expect(getDrawerSection()).toBeNull();
  });

  it("任何关闭路径清一次性意图(不许悬留到下次 ⌘K)", () => {
    toggleDrawerSection("skill");
    setDrawerOpen(false); // Esc/⌘K/× 都走此口
    expect(getDrawerSection()).toBeNull();
    setDrawerOpen(true);
    expect(getDrawerSection()).toBeNull();
  });

  it("applyDrawerSection 镜像:值变化才通知(同值幂等不回环)", () => {
    setDrawerOpen(true);
    const notify = vi.fn();
    const off = subscribe(notify);
    applyDrawerSection("command");
    expect(notify).toHaveBeenCalledOnce();
    applyDrawerSection("command");
    expect(notify).toHaveBeenCalledOnce();
    applyDrawerSection("all"); // 镜像回 null
    expect(notify).toHaveBeenCalledTimes(2);
    off();
  });
});
