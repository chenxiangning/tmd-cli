/**
 * themePresets 目录完整性不变量 —— 本文件(1349 行)后续拆分的安全网。
 * 覆盖:preset id 唯一性、必填字段齐全、light/dark 分组与 appearance 一致、
 * colors/syntax/diff 值合法性、与 themeTokens 消费契约对齐。
 */
import { describe, expect, it } from "vitest";

import {
  ALL_THEME_PRESET_IDS,
  DARK_THEME_PRESET_IDS,
  DEFAULT_DARK_THEME_PRESET_ID,
  DEFAULT_LIGHT_THEME_PRESET_ID,
  getAllThemePresets,
  getThemePreset,
  isThemePresetId,
  LIGHT_THEME_PRESET_IDS,
  type DiffTokens,
  type SyntaxTokens,
  type ThemePresetId,
} from "./themePresets";
import {
  mapPresetToTokens,
  normalizeHexColor,
  THEME_CSS_VARIABLE_KEYS,
} from "./themeTokens";

const SYNTAX_KEYS: readonly (keyof SyntaxTokens)[] = [
  "keyword",
  "string",
  "comment",
  "number",
  "function",
  "operator",
  "type",
  "tag",
];
const DIFF_KEYS: readonly (keyof DiffTokens)[] = ["inserted", "removed"];

describe("preset 目录完整性", () => {
  it("preset id 全局唯一,getAllThemePresets 与 ALL_THEME_PRESET_IDS 一一对应", () => {
    const presets = getAllThemePresets();
    expect(presets).toHaveLength(ALL_THEME_PRESET_IDS.length);
    expect(new Set(presets.map((p) => p.id)).size).toBe(ALL_THEME_PRESET_IDS.length);
    expect(presets.map((p) => p.id)).toEqual([...ALL_THEME_PRESET_IDS]);
  });

  it("light/dark 分组合集等于全量 id,且无交叉", () => {
    expect([...LIGHT_THEME_PRESET_IDS, ...DARK_THEME_PRESET_IDS]).toEqual([
      ...ALL_THEME_PRESET_IDS,
    ]);
    const overlap = LIGHT_THEME_PRESET_IDS.filter((id) =>
      (DARK_THEME_PRESET_IDS as readonly string[]).includes(id),
    );
    expect(overlap).toEqual([]);
  });

  it("每个 preset 必填字段齐全:label 非空、colors 非空、appearance 合法", () => {
    for (const preset of getAllThemePresets()) {
      expect(preset.label.trim().length, preset.id).toBeGreaterThan(0);
      expect(Object.keys(preset.colors).length, preset.id).toBeGreaterThan(0);
      expect(["light", "dark"], preset.id).toContain(preset.appearance);
    }
  });

  it("分组与 appearance 声明一致:light 组全是 light,dark 组全是 dark", () => {
    for (const id of LIGHT_THEME_PRESET_IDS) {
      expect(getThemePreset(id).appearance, id).toBe("light");
    }
    for (const id of DARK_THEME_PRESET_IDS) {
      expect(getThemePreset(id).appearance, id).toBe("dark");
    }
  });

  it("默认 light/dark preset 落在各自分组内", () => {
    expect(LIGHT_THEME_PRESET_IDS).toContain(DEFAULT_LIGHT_THEME_PRESET_ID);
    expect(DARK_THEME_PRESET_IDS).toContain(DEFAULT_DARK_THEME_PRESET_ID);
  });
});

describe("preset 数据合法性", () => {
  it("所有 colors 值均可归一化为 #rrggbb(映射器不做二次校验)", () => {
    for (const preset of getAllThemePresets()) {
      for (const [key, value] of Object.entries(preset.colors)) {
        expect(normalizeHexColor(value), `${preset.id} ${key}=${value}`).not.toBeNull();
      }
    }
  });

  it("syntax/diff 段若存在,键不超出消费契约且值均为合法 hex", () => {
    for (const preset of getAllThemePresets()) {
      if (preset.syntax) {
        for (const [key, value] of Object.entries(preset.syntax)) {
          expect(SYNTAX_KEYS, `${preset.id} syntax.${key}`).toContain(key);
          expect(normalizeHexColor(value), `${preset.id} syntax.${key}=${value}`).not.toBeNull();
        }
      }
      if (preset.diff) {
        for (const [key, value] of Object.entries(preset.diff)) {
          expect(DIFF_KEYS, `${preset.id} diff.${key}`).toContain(key);
          expect(normalizeHexColor(value), `${preset.id} diff.${key}=${value}`).not.toBeNull();
        }
      }
    }
  });
});

describe("getThemePreset / isThemePresetId", () => {
  it("getThemePreset 返回的 id 与入参一致", () => {
    for (const id of ALL_THEME_PRESET_IDS) {
      expect(getThemePreset(id).id).toBe(id);
    }
  });

  it("isThemePresetId 接受全部合法 id", () => {
    for (const id of ALL_THEME_PRESET_IDS) {
      expect(isThemePresetId(id)).toBe(true);
    }
  });

  it("isThemePresetId 拒绝未知 id 与空值", () => {
    expect(isThemePresetId("vscode-not-exists")).toBe(false);
    expect(isThemePresetId("")).toBe(false);
    expect(isThemePresetId(null)).toBe(false);
    expect(isThemePresetId(undefined)).toBe(false);
  });

  it("getThemePreset 浅拷贝:顶层改写不污染目录,colors 引用共享(调用方不得原地改)", () => {
    const id: ThemePresetId = "vscode-dark-modern";
    const first = getThemePreset(id);
    first.label = "已污染";
    expect(getThemePreset(id).label).not.toBe("已污染");
    expect(getThemePreset(id).colors).toBe(first.colors);
  });
});

describe("与 themeTokens 的消费契约", () => {
  it("每个 preset 都映射出全量 --tmd-* 变量,且值非空", () => {
    for (const preset of getAllThemePresets()) {
      const tokens = mapPresetToTokens(preset);
      for (const key of THEME_CSS_VARIABLE_KEYS) {
        expect(tokens[key], `${preset.id} ${key}`).toBeTruthy();
      }
    }
  });
});

describe("浅色主题终端可读性(2026-09-08 浅色扩充回归防线)", () => {
  it("浅色 preset 共 19 套", () => {
    expect(LIGHT_THEME_PRESET_IDS).toHaveLength(19);
  });

  it("每套浅色 preset 自带 terminal.ansi* 16 槽(不落全局兜底表)", () => {
    const SLOTS = ["Black","Red","Green","Yellow","Blue","Magenta","Cyan","White",
      "BrightBlack","BrightRed","BrightGreen","BrightYellow",
      "BrightBlue","BrightMagenta","BrightCyan","BrightWhite"] as const;
    for (const preset of getAllThemePresets().filter((p) => p.appearance === "light")) {
      for (const slot of SLOTS) {
        expect(
          normalizeHexColor(preset.colors[`terminal.ansi${slot}`]),
          `${preset.id} terminal.ansi${slot}`,
        ).not.toBeNull();
      }
    }
  });

  it("ANSI 16 色对终端背景 WCAG 对比度全部 ≥3:1(浅底看不清的主诉防线)", () => {
    const luminance = (hex: string) => {
      const c = hex.slice(1);
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
      const adj = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * adj(r) + 0.7152 * adj(g) + 0.0722 * adj(b);
    };
    const contrast = (a: string, b: string) => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    for (const preset of getAllThemePresets().filter((p) => p.appearance === "light")) {
      const bg =
        preset.colors["terminal.background"] ?? preset.colors["editor.background"];
      for (const [key, value] of Object.entries(preset.colors)) {
        if (!key.startsWith("terminal.ansi")) continue;
        const fg = normalizeHexColor(value);
        if (!fg) continue;
        expect(
          contrast(fg, bg),
          `${preset.id} ${key}=${value} on ${bg}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
