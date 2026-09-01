/**
 * themeTokens 颜色工具与 preset→token 映射契约测试。
 * 覆盖:hex 归一化边界、混色/透明度/对比文字色、缺失 token 的语义链回退、
 * getColor 优先级、syntax/diff 部分覆盖与兜底。
 */
import { describe, expect, it } from "vitest";

import type { ThemePresetDefinition } from "./themePresets";
import {
  getContrastingTextColor,
  mapPresetToTokens,
  mixHexColors,
  normalizeHexColor,
  THEME_CSS_VARIABLE_KEYS,
  withAlpha,
} from "./themeTokens";

/** 最小合法 preset:只有必填字段,colors 可定制。 */
function presetOf(
  appearance: "light" | "dark",
  colors: Record<string, string>,
  extra?: Partial<ThemePresetDefinition>,
): ThemePresetDefinition {
  return { id: "vscode-dark-modern", appearance, label: "测试", colors, ...extra };
}

describe("normalizeHexColor", () => {
  it("#rgb 展开为 #rrggbb 并归一小写", () => {
    expect(normalizeHexColor("#ABC")).toBe("#aabbcc");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
  });

  it("#rrggbb 归一小写;不带 # 前缀也接受", () => {
    expect(normalizeHexColor("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHexColor("a1b2c3")).toBe("#a1b2c3");
  });

  it("非法输入返回 null:空值/空串/非法字符/错误长度", () => {
    expect(normalizeHexColor(null)).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("#gggggg")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("#aabbccdd")).toBeNull();
  });
});

describe("mixHexColors / withAlpha / getContrastingTextColor", () => {
  it("t=0 返回 a,t=1 返回 b,t=0.5 取中点(四舍五入)", () => {
    expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("withAlpha 输出 rgba() 字符串", () => {
    expect(withAlpha("#007acc", 0.14)).toBe("rgba(0,122,204,0.14)");
  });

  it("亮底取深文字 #1f1f1f,暗底取 #ffffff", () => {
    expect(getContrastingTextColor("#ffffff")).toBe("#1f1f1f");
    expect(getContrastingTextColor("#000000")).toBe("#ffffff");
  });
});

describe("mapPresetToTokens 缺失 token 回退", () => {
  it("空 colors 的 dark preset:bg-base 兜底 #1e1e1e,fg 兜底 #d4d4d4", () => {
    const tokens = mapPresetToTokens(presetOf("dark", {}));
    expect(tokens["--tmd-bg-base"]).toBe("#1e1e1e");
    expect(tokens["--tmd-fg"]).toBe("#d4d4d4");
    expect(tokens["--tmd-accent"]).toBe("#007acc");
  });

  it("空 colors 的 light preset:bg-base 兜底 #ffffff,fg 兜底 #1f1f1f", () => {
    const tokens = mapPresetToTokens(presetOf("light", {}));
    expect(tokens["--tmd-bg-base"]).toBe("#ffffff");
    expect(tokens["--tmd-fg"]).toBe("#1f1f1f");
    expect(tokens["--tmd-accent"]).toBe("#005fb8");
  });

  it("bg-elevated 缺 sideBar.background 时由 bg-base 混色派生(dark 压黑 12%)", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", { "editor.background": "#1e1e1e" }),
    );
    expect(tokens["--tmd-bg-elevated"]).toBe(mixHexColors("#1e1e1e", "#000000", 0.12));
  });

  it("非法颜色值(非 hex)视同缺失,走同一兜底链", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", { "editor.background": "not-a-color" }),
    );
    expect(tokens["--tmd-bg-base"]).toBe("#1e1e1e");
  });

  it("syntax/diff 整段缺失时使用对应 appearance 的兜底表", () => {
    const tokens = mapPresetToTokens(presetOf("dark", {}));
    expect(tokens["--tmd-syntax-keyword"]).toBe("#8bd5ff");
    expect(tokens["--tmd-diff-inserted"]).toBe("#2ea043");
  });
});

describe("mapPresetToTokens getColor 优先级", () => {
  it("fg:foreground 优先于 editor.foreground", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", {
        foreground: "#111111",
        "editor.foreground": "#222222",
      }),
    );
    expect(tokens["--tmd-fg"]).toBe("#111111");
  });

  it("fg:foreground 缺失时回退 editor.foreground", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", { "editor.foreground": "#222222" }),
    );
    expect(tokens["--tmd-fg"]).toBe("#222222");
  });

  it("accent:button.background 优先于 textLink.foreground", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", {
        "button.background": "#111111",
        "textLink.foreground": "#222222",
      }),
    );
    expect(tokens["--tmd-accent"]).toBe("#111111");
  });

  it("accent:button.background 缺失时回退 textLink.foreground", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", { "textLink.foreground": "#222222" }),
    );
    expect(tokens["--tmd-accent"]).toBe("#222222");
  });

  it("border:input.border > dropdown.border > panel.border", () => {
    const onlyPanel = mapPresetToTokens(
      presetOf("dark", { "panel.border": "#333333" }),
    );
    expect(onlyPanel["--tmd-border"]).toBe("#333333");
    const withDropdown = mapPresetToTokens(
      presetOf("dark", { "panel.border": "#333333", "dropdown.border": "#222222" }),
    );
    expect(withDropdown["--tmd-border"]).toBe("#222222");
    const withInput = mapPresetToTokens(
      presetOf("dark", {
        "panel.border": "#333333",
        "dropdown.border": "#222222",
        "input.border": "#111111",
      }),
    );
    expect(withInput["--tmd-border"]).toBe("#111111");
  });
});

describe("mapPresetToTokens syntax/diff 部分覆盖", () => {
  it("syntax 只覆盖给出的键,其余键保留兜底值", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", {}, { syntax: { keyword: "#123456" } }),
    );
    expect(tokens["--tmd-syntax-keyword"]).toBe("#123456");
    expect(tokens["--tmd-syntax-string"]).toBe("#7ee787");
  });

  it("diff 给出的值直通输出", () => {
    const tokens = mapPresetToTokens(
      presetOf("light", {}, { diff: { inserted: "#111111", removed: "#222222" } }),
    );
    expect(tokens["--tmd-diff-inserted"]).toBe("#111111");
    expect(tokens["--tmd-diff-removed"]).toBe("#222222");
  });
});

describe("THEME_CSS_VARIABLE_KEYS", () => {
  it("与 mapPresetToTokens 输出键完全一致,全部 --tmd- 前缀且无重复", () => {
    const tokens = mapPresetToTokens(presetOf("dark", {}));
    expect([...THEME_CSS_VARIABLE_KEYS].sort()).toEqual(Object.keys(tokens).sort());
    expect(new Set(THEME_CSS_VARIABLE_KEYS).size).toBe(THEME_CSS_VARIABLE_KEYS.length);
    for (const key of THEME_CSS_VARIABLE_KEYS) {
      expect(key.startsWith("--tmd-")).toBe(true);
    }
  });
});
