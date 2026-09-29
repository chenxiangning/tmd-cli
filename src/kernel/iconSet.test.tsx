/**
 * DecorIcon 组合解析契约:
 * - classic(组合1):Fallback 原样渲染,不传 weight(吃全局 IconContext bold),
 *   仅 newchat 保留现状显式 duotone;
 * - solid(组合2):同字形 weight fill;
 * - metaphor(组合3):键表换隐喻字形 + bold(fold 双态方向键除外);
 * - lucide/lucide-alt(组合4/5):Lucide IconNode 渲染(morphicons 弹簧变形在
 *   4↔5 之间由 MorphIcon prop 变化自然触发;Phosphor↔Lucide 跨族跳变)。
 * react-dom/server 渲染断言(模式同 VersionMenu.test.tsx),settings 以桩替代。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Folder, GitMerge, RocketLaunch, Sparkle, type Icon } from "@phosphor-icons/react";

const state = vi.hoisted(() => ({ iconSet: "classic" as string }));
vi.mock("./settings", () => ({
  useSettingsState: () => ({ settings: { iconSet: state.iconSet } }),
}));
import { DecorIcon } from "./iconSet";
import { resolveDecorIcon } from "./iconSetTables";
import type { IconDecorId } from "./settingsAppearance";
import { ICON_DECOR_IDS } from "./settingsAppearance";

const ALL_IDS = ICON_DECOR_IDS;


function render(id: IconDecorId, Fallback: Icon, props?: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(DecorIcon, { id, Fallback, ...props }));
}

describe("DecorIcon 组合解析", () => {
  it("classic:Fallback 原样渲染,不传 weight(吃全局默认 bold)", () => {
    state.iconSet = "classic";
    expect(render("panel-files", Folder, { size: "1rem" })).toBe(
      renderToStaticMarkup(createElement(Folder, { size: "1rem" })),
    );
  });

  it("classic:newchat 保留现状 duotone", () => {
    state.iconSet = "classic";
    expect(render("newchat", RocketLaunch, { size: "0.9375rem" })).toBe(
      renderToStaticMarkup(createElement(RocketLaunch, { size: "0.9375rem", weight: "duotone" })),
    );
  });

  it("solid:同字形 weight fill", () => {
    state.iconSet = "solid";
    expect(render("panel-files", Folder, { size: "1rem" })).toBe(
      renderToStaticMarkup(createElement(Folder, { size: "1rem", weight: "fill" })),
    );
  });

  it("metaphor:换隐喻字形(panel-git → GitMerge / newchat → Sparkle)+ bold", () => {
    state.iconSet = "metaphor";
    expect(render("panel-git", Folder, { size: "1rem" })).toBe(
      renderToStaticMarkup(createElement(GitMerge, { size: "1rem", weight: "bold" })),
    );
    expect(render("newchat", RocketLaunch, { size: "1rem" })).toBe(
      renderToStaticMarkup(createElement(Sparkle, { size: "1rem", weight: "bold" })),
    );
  });

  it("classic/solid:无字形覆盖;metaphor 全表覆盖(fold 双态方向键除外)", () => {
    for (const id of ALL_IDS) {
      expect(resolveDecorIcon("classic", id).kind).toBe("phosphor");
      expect(resolveDecorIcon("solid", id).kind).toBe("phosphor");
      if (id === "fold-left" || id === "fold-right") {
        expect(resolveDecorIcon("metaphor", id).glyph).toBeUndefined();
      } else {
        expect(resolveDecorIcon("metaphor", id).glyph).toBeTruthy();
      }
    }
  });

  it("lucide/lucide-alt:kind=lucide 且两表逐键不同(fold 例外,回 phosphor)", () => {
    for (const id of ALL_IDS) {
      const a = resolveDecorIcon("lucide", id);
      const b = resolveDecorIcon("lucide-alt", id);
      if (id === "fold-left" || id === "fold-right") {
        expect(a).toMatchObject({ kind: "phosphor" });
        expect(b).toMatchObject({ kind: "phosphor" });
      } else {
        expect(a).toMatchObject({ kind: "lucide" });
        expect(b).toMatchObject({ kind: "lucide" });
        expect(a.icon).not.toEqual(b.icon);
      }
    }
    expect(resolveDecorIcon("lucide", "unknown-panel").kind).toBe("phosphor");
  });

  it("lucide:渲染 Lucide 字形(24 网格,非 Phosphor Fallback)", () => {
    state.iconSet = "lucide";
    const html = render("newchat", RocketLaunch, { size: "1rem" });
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).not.toContain('viewBox="0 0 256 256"');
  });
});
