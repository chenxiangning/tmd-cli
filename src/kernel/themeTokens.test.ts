/**
 * themeTokens 颜色工具与 preset→token 映射契约测试。
 * 覆盖:hex 归一化边界、混色/透明度/对比文字色、缺失 token 的语义链回退、
 * getColor 优先级、syntax/diff 部分覆盖与兜底。
 */
import { describe, expect, it } from "vitest";

import type { ThemePresetDefinition } from "./themePresets";
import { getThemePreset } from "./themePresets";
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

  it("bg-panel 与 bg-elevated 同源(壁纸态单独调薄,elevated 保浮层实底)", () => {
    const tokens = mapPresetToTokens(
      presetOf("dark", { "editor.background": "#1e1e1e" }),
    );
    expect(tokens["--tmd-bg-panel"]).toBe(tokens["--tmd-bg-elevated"]);
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

describe("终端 ANSI 16 色 token", () => {
  it("浅色 preset:16 槽位齐全,值 = VS Code 官方浅色默认表", () => {
    const tokens = mapPresetToTokens(presetOf("light", {}));
    expect(tokens["--tmd-terminal-black"]).toBe("#000000");
    expect(tokens["--tmd-terminal-red"]).toBe("#cd3131");
    expect(tokens["--tmd-terminal-green"]).toBe("#107c10");
    expect(tokens["--tmd-terminal-yellow"]).toBe("#949800");
    expect(tokens["--tmd-terminal-blue"]).toBe("#0451a5");
    expect(tokens["--tmd-terminal-bright-black"]).toBe("#666666");
    expect(tokens["--tmd-terminal-bright-yellow"]).toBe("#b5ba00");
    expect(tokens["--tmd-terminal-bright-white"]).toBe("#a5a5a5");
    for (const slot of ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "bright-black", "bright-red", "bright-green", "bright-yellow",
      "bright-blue", "bright-magenta", "bright-cyan", "bright-white"]) {
      expect(tokens[`--tmd-terminal-${slot}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("深色 preset:取 VS Code 深色默认表(brightGreen/Blue 与浅色表不同)", () => {
    const tokens = mapPresetToTokens(presetOf("dark", {}));
    expect(tokens["--tmd-terminal-green"]).toBe("#0dbc79");
    expect(tokens["--tmd-terminal-bright-blue"]).toBe("#3b8eea");
    expect(tokens["--tmd-terminal-bright-white"]).toBe("#e5e5e5");
  });

  it("preset 可用 terminal.ansi* 逐槽覆盖(VS Code 命名)", () => {
    const tokens = mapPresetToTokens(
      presetOf("light", { "terminal.ansiRed": "#ff0000", "terminal.ansiBrightWhite": "#123456" }),
    );
    expect(tokens["--tmd-terminal-red"]).toBe("#ff0000");
    expect(tokens["--tmd-terminal-bright-white"]).toBe("#123456");
    expect(tokens["--tmd-terminal-blue"]).toBe("#0451a5");
  });
});

// ── fg 三档对比度收口(2026-10-02;WCAG 相对亮度口径,本地实现零依赖) ──────────

function wcagChannel(v: number): number {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return (
    0.2126 * wcagChannel(byte(1)) + 0.7152 * wcagChannel(byte(3)) + 0.0722 * wcagChannel(byte(5))
  );
}

/** WCAG 对比度(#rrggbb 对 #rrggbb,三档 token 均为实色 hex)。 */
function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("fg 三档对比度收口(六 tmd 主题)", () => {
  const TMD_IDS = [
    "tmd-paper",
    "tmd-mist",
    "tmd-linen",
    "tmd-graphite",
    "tmd-ink",
    "tmd-ember",
  ] as const;

  /** muted/subtle/faint 三档各自对侧栏底(sideBar.background)的对比度。 */
  function tierContrasts(id: (typeof TMD_IDS)[number]): [number, number, number] {
    const preset = getThemePreset(id);
    const tokens = mapPresetToTokens(preset);
    const sidebar = preset.colors["sideBar.background"]!;
    return [
      contrastRatio(tokens["--tmd-fg-muted"], sidebar),
      contrastRatio(tokens["--tmd-fg-subtle"], sidebar),
      contrastRatio(tokens["--tmd-fg-faint"], sidebar),
    ];
  }

  it("浅色三主题 fg-muted@侧栏底 ≥ 4.5(收口前 mist/linen 为 4.05/4.06)", () => {
    for (const id of TMD_IDS.slice(0, 3)) {
      expect(tierContrasts(id)[0], id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("浅色三主题三档区分度:相邻档对比度差 ≥ 1.5", () => {
    for (const id of TMD_IDS.slice(0, 3)) {
      const [m, s, f] = tierContrasts(id);
      expect(m - s, `${id} muted-subtle 档距`).toBeGreaterThanOrEqual(1.5);
      expect(s - f, `${id} subtle-faint 档距`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("深色三主题不回退:fg-muted@侧栏底 ≥ 5.7(收口前最低 5.71)", () => {
    for (const id of TMD_IDS.slice(3)) {
      expect(tierContrasts(id)[0], id).toBeGreaterThanOrEqual(5.7);
    }
  });

  it("混色系数钉死 0.28/0.42/0.68(faint 不取 0.62 提案,档距优先)", () => {
    const tokens = mapPresetToTokens(getThemePreset("tmd-mist"));
    const fg = tokens["--tmd-fg"];
    const bg = tokens["--tmd-bg-base"];
    expect(tokens["--tmd-fg-muted"]).toBe(mixHexColors(fg, bg, 0.28));
    expect(tokens["--tmd-fg-subtle"]).toBe(mixHexColors(fg, bg, 0.42));
    expect(tokens["--tmd-fg-faint"]).toBe(mixHexColors(fg, bg, 0.68));
  });
});
