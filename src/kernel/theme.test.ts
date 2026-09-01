/**
 * theme.ts 外观解析契约测试。
 * 只测纯函数 resolveEffectiveAppearance(DOM 应用/订阅逻辑不在本文件范围)。
 * 覆盖:custom → preset.appearance、system → 跟随系统、light/dark 直出、优先级。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/ipc", () => ({
  ipc: {},
}));

import { resolveEffectiveAppearance } from "./theme";

describe("resolveEffectiveAppearance", () => {
  it("custom:取 customThemePresetId 对应 preset 的 appearance", () => {
    expect(
      resolveEffectiveAppearance(
        { theme: "custom", customThemePresetId: "vscode-nord" },
        false,
      ),
    ).toBe("dark");
    expect(
      resolveEffectiveAppearance(
        { theme: "custom", customThemePresetId: "vscode-ayu-light" },
        true,
      ),
    ).toBe("light");
  });

  it("custom:忽略 systemDark,由 preset 决定明暗", () => {
    const settings = {
      theme: "custom",
      customThemePresetId: "vscode-nord",
    } as const;
    expect(resolveEffectiveAppearance(settings, true)).toBe("dark");
    expect(resolveEffectiveAppearance(settings, false)).toBe("dark");
  });

  it("system:跟随 systemDark 落 light/dark", () => {
    const settings = { theme: "system", customThemePresetId: "vscode-nord" } as const;
    expect(resolveEffectiveAppearance(settings, true)).toBe("dark");
    expect(resolveEffectiveAppearance(settings, false)).toBe("light");
  });

  it("light/dark:直出,与 systemDark 无关", () => {
    const base = { customThemePresetId: "vscode-nord" } as const;
    expect(resolveEffectiveAppearance({ ...base, theme: "light" }, true)).toBe("light");
    expect(resolveEffectiveAppearance({ ...base, theme: "dark" }, false)).toBe("dark");
  });
});
