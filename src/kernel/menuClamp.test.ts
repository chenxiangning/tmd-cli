import { afterEach, describe, expect, it, vi } from "vitest";
import { clampToViewport } from "./menuClamp";

describe("clampToViewport 视口夹取", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("视口内不动,越界夹回,负值按下限截断", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    expect(clampToViewport(100, 100, 200, 100)).toEqual({ x: 100, y: 100 });
    expect(clampToViewport(900, 900, 200, 100)).toEqual({ x: 788, y: 688 });
    expect(clampToViewport(-5, -5, 200, 100)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(-5, -5, 200, 100, 0)).toEqual({ x: 0, y: 0 });
  });

  it("极小视口不出负坐标(max-outer 纪律)", () => {
    vi.stubGlobal("window", { innerWidth: 50, innerHeight: 40 });
    expect(clampToViewport(10, 10, 200, 100)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport(10, 10, 200, 100, 0)).toEqual({ x: 0, y: 0 });
  });
});
