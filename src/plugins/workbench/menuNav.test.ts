/**
 * 菜单键盘导航下标契约(纯函数)。
 * 覆盖:环绕、未入菜单的落点、Home/End、非菜单键放行、空菜单边界。
 */
import { describe, expect, it } from "vitest";
import { menuNavIndex } from "./menuNav";

describe("menuNavIndex", () => {
  it("ArrowDown 下移并环绕", () => {
    expect(menuNavIndex("ArrowDown", 0, 3)).toBe(1);
    expect(menuNavIndex("ArrowDown", 2, 3)).toBe(0);
  });

  it("ArrowUp 上移并环绕", () => {
    expect(menuNavIndex("ArrowUp", 2, 3)).toBe(1);
    expect(menuNavIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("焦点未落进菜单时:ArrowDown 落首项,ArrowUp 落末项", () => {
    expect(menuNavIndex("ArrowDown", -1, 3)).toBe(0);
    expect(menuNavIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("Home / End 跳首末", () => {
    expect(menuNavIndex("Home", 2, 3)).toBe(0);
    expect(menuNavIndex("End", 0, 3)).toBe(2);
  });

  it("非菜单键返回 null(调用方放行)", () => {
    expect(menuNavIndex("Enter", 0, 3)).toBeNull();
    expect(menuNavIndex("Escape", 0, 3)).toBeNull();
    expect(menuNavIndex("Tab", 0, 3)).toBeNull();
  });

  it("空菜单恒 null", () => {
    expect(menuNavIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("单项菜单:上下都停在唯一项", () => {
    expect(menuNavIndex("ArrowDown", 0, 1)).toBe(0);
    expect(menuNavIndex("ArrowUp", 0, 1)).toBe(0);
  });
});
