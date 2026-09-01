/**
 * 文件视觉注册点行为契约测试。
 * 覆盖:fallback 兜底、首个非空 provider 胜出、order 优先级与同号注册序、
 * null/空 svgHtml 让位、match 参数透传(name/isDir/expanded)。
 * 模块级单例,每个用例经 vi.resetModules + 动态 import 取全新实例。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileVisualHint } from "./fileVisual";

type FileVisualModule = typeof import("./fileVisual");

let visual: FileVisualModule;

function hint(tag: string): FileVisualHint {
  return { svgHtml: `<svg data-tag="${tag}"/>`, colorClass: `text-${tag}` };
}

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块是模块级单例,必须借 resetModules 取全新实例
  visual = await import("./fileVisual");
});

describe("fallback 兜底", () => {
  it("无 provider 时返回内置文件图标 fallback", () => {
    const h = visual.resolveFileVisual("a.ts", false);
    expect(h.svgHtml).toContain("<svg");
    expect(h.colorClass).toBe("text-(--tmd-fg)");
  });

  it("provider 全部返回 null 时回落 fallback", () => {
    visual.registerFileVisual({ match: () => null });
    visual.registerFileVisual({ match: () => undefined });
    const h = visual.resolveFileVisual("a.ts", false);
    expect(h.colorClass).toBe("text-(--tmd-fg)");
  });
});

describe("provider 优先级", () => {
  it("order 小的先评估并胜出", () => {
    visual.registerFileVisual({ order: 10, match: () => hint("late") });
    visual.registerFileVisual({ order: 1, match: () => hint("early") });
    expect(visual.resolveFileVisual("a.ts", false).colorClass).toBe("text-early");
  });

  it("同 order 按注册顺序,先注册先评估", () => {
    visual.registerFileVisual({ order: 5, match: () => hint("first") });
    visual.registerFileVisual({ order: 5, match: () => hint("second") });
    expect(visual.resolveFileVisual("a.ts", false).colorClass).toBe("text-first");
  });

  it("缺省 order 视为 0", () => {
    visual.registerFileVisual({ order: 3, match: () => hint("ordered") });
    visual.registerFileVisual({ match: () => hint("default-order") });
    expect(visual.resolveFileVisual("a.ts", false).colorClass).toBe(
      "text-default-order",
    );
  });

  it("前位 provider 未命中(null)时让位下一个", () => {
    visual.registerFileVisual({
      order: 1,
      match: (name) => (name.endsWith(".md") ? hint("md") : null),
    });
    visual.registerFileVisual({ order: 2, match: () => hint("generic") });
    expect(visual.resolveFileVisual("a.ts", false).colorClass).toBe("text-generic");
    expect(visual.resolveFileVisual("a.md", false).colorClass).toBe("text-md");
  });

  it("返回 hint 但 svgHtml 为空串视为未命中,让位后续", () => {
    visual.registerFileVisual({
      order: 1,
      match: () => ({ svgHtml: "", colorClass: "text-empty" }),
    });
    visual.registerFileVisual({ order: 2, match: () => hint("real") });
    expect(visual.resolveFileVisual("a.ts", false).colorClass).toBe("text-real");
  });
});

describe("match 参数透传", () => {
  it("name/isDir/expanded 原样传给 provider", () => {
    const match = vi.fn().mockReturnValue(null);
    visual.registerFileVisual({ match });
    visual.resolveFileVisual("src", true, true);
    expect(match).toHaveBeenCalledWith("src", true, true);
  });

  it("expanded 缺省为 false", () => {
    const match = vi.fn().mockReturnValue(null);
    visual.registerFileVisual({ match });
    visual.resolveFileVisual("src", true);
    expect(match).toHaveBeenCalledWith("src", true, false);
  });
});
