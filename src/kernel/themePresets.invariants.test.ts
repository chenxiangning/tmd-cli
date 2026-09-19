/**
 * themePresets 数据模块结构不变量 —— 补 themePresets.test.ts 未覆盖的缺口。
 * 契约清单:
 * 1. dark.ts/light.ts 数据模块导出条目与 index id 清单一一对应(无死条目、无漏登记)
 * 2. 每个 preset 必备 28 个核心 token 且色值合法(映射器对缺键静默落兜底值,这里显式钉死)
 * 3. dark 族键集合单一签名,且词汇恰为 核心集 ∪ dark 族扩展(缺键/编外键都算回归)
 * 4. 全目录词汇表恰为 核心集 ∪ dark 族扩展 ∪ 浅色 ansi16:dark 与 light 族共享同一
 *    核心词汇,浅色唯一允许的扩展是终端 ANSI 16 槽,任何一方不得私加编外键
 */
import { describe, expect, it } from "vitest";

import { DARK_PRESETS } from "./themePresets/dark";
import { LIGHT_PRESETS } from "./themePresets/light";
import {
  DARK_THEME_PRESET_IDS,
  LIGHT_THEME_PRESET_IDS,
  getAllThemePresets,
} from "./themePresets";
import { normalizeHexColor } from "./themeTokens";

/** 全部 preset(31 套)共同必备的核心 token,按字母序排列(2026-09-19 实测交集钉死) */
const CORE_COLOR_KEYS = [
  "activityBar.background",
  "activityBar.foreground",
  "badge.background",
  "badge.foreground",
  "button.secondaryBackground",
  "button.secondaryForeground",
  "dropdown.background",
  "editor.background",
  "editor.foreground",
  "editorLineNumber.foreground",
  "editorWidget.background",
  "foreground",
  "input.background",
  "input.foreground",
  "list.activeSelectionBackground",
  "list.activeSelectionForeground",
  "list.hoverBackground",
  "panel.background",
  "panel.border",
  "sideBar.background",
  "sideBar.foreground",
  "statusBar.background",
  "statusBar.foreground",
  "terminal.background",
  "terminal.selectionBackground",
  "terminalCursor.foreground",
  "titleBar.activeBackground",
  "titleBar.activeForeground",
] as const;

/** 仅 dark 族全量携带、浅色族部分同步的扩展 token(移植自 codemoss 的上游现状) */
const DARK_FAMILY_EXTRA_KEYS = [
  "button.background",
  "button.foreground",
  "descriptionForeground",
  "dropdown.border",
  "editorGutter.addedBackground",
  "editorGutter.deletedBackground",
  "editorGutter.modifiedBackground",
  "input.border",
  "textLink.foreground",
  "terminal.foreground",
] as const;

/** 浅色族唯一允许的扩展:终端 ANSI 16 槽(dark 族走 themeTokens 的全局兜底表) */
const ANSI_SLOTS = [
  "Black",
  "Red",
  "Green",
  "Yellow",
  "Blue",
  "Magenta",
  "Cyan",
  "White",
  "BrightBlack",
  "BrightRed",
  "BrightGreen",
  "BrightYellow",
  "BrightBlue",
  "BrightMagenta",
  "BrightCyan",
  "BrightWhite",
] as const;

const ANSI_KEYS = ANSI_SLOTS.map((slot) => `terminal.ansi${slot}`);
const EXPECTED_DARK_KEYS = [
  ...new Set<string>([...CORE_COLOR_KEYS, ...DARK_FAMILY_EXTRA_KEYS]),
].sort();
const EXPECTED_ALL_KEYS = [
  ...new Set<string>([...CORE_COLOR_KEYS, ...DARK_FAMILY_EXTRA_KEYS, ...ANSI_KEYS]),
].sort();

describe("themePresets 数据模块结构不变量", () => {
  it("数据模块导出条目与 index id 清单一一对应:无死条目、无漏登记", () => {
    const darkKeys = Object.keys(DARK_PRESETS).sort();
    const lightKeys = Object.keys(LIGHT_PRESETS).sort();
    expect(darkKeys).toEqual([...DARK_THEME_PRESET_IDS].sort());
    expect(lightKeys).toEqual([...LIGHT_THEME_PRESET_IDS].sort());
    // 目录规模钉死:整族被误删时即使 index 同步缩水也能在此暴露
    expect(darkKeys).toHaveLength(12);
    expect(lightKeys).toHaveLength(19);
    // 条目本体必须是含非空 colors 的对象,防止 undefined/残缺条目混入
    for (const [id, entry] of [
      ...Object.entries(DARK_PRESETS),
      ...Object.entries(LIGHT_PRESETS),
    ]) {
      expect(entry, id).toBeTruthy();
      expect(Object.keys(entry.colors).length, id).toBeGreaterThan(0);
    }
  });

  it("每个 preset 必备全部核心 token 且色值合法(映射器缺键会静默落兜底)", () => {
    for (const preset of getAllThemePresets()) {
      for (const key of CORE_COLOR_KEYS) {
        const value = preset.colors[key];
        expect(value, `${preset.id} 缺核心 token ${key}`).toBeTruthy();
        expect(
          normalizeHexColor(value),
          `${preset.id} ${key}=${String(value)}`,
        ).not.toBeNull();
      }
    }
  });

  it("dark 族键集合单一签名,且词汇恰为核心集 ∪ dark 族扩展", () => {
    const darkPresets = getAllThemePresets().filter(
      (p) => p.appearance === "dark",
    );
    const signatures = new Set(
      darkPresets.map((p) => Object.keys(p.colors).sort().join(",")),
    );
    expect(signatures.size, `dark 族出现 ${signatures.size} 种键集合签名`).toBe(
      1,
    );
    expect([...signatures][0].split(",")).toEqual(EXPECTED_DARK_KEYS);
  });

  it("全目录词汇表恰为核心集 ∪ dark 族扩展 ∪ ansi16:无编外键,两族词汇一致", () => {
    const universe = [
      ...new Set<string>(
        getAllThemePresets().flatMap((p) => Object.keys(p.colors)),
      ),
    ].sort();
    expect(universe).toEqual(EXPECTED_ALL_KEYS);
  });
});
