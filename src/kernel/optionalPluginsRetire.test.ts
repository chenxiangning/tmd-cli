/**
 * 非核心能力默认停用迁移契约 —— 批次 H 可选化(H-01/H-02/H-03 共享路径)。
 */
import { describe, expect, it } from "vitest";
import { applyOptionalPluginsRetirement, OPTIONAL_PLUGINS_DEFAULT_OFF } from "./optionalPluginsRetire";

describe("applyOptionalPluginsRetirement", () => {
  it("首次执行:三个插件 id 追加进 disabledPlugins 并立 marker", () => {
    const out = applyOptionalPluginsRetirement({ disabledPlugins: [], optionalPluginsDefaultOff: false });
    expect(out.disabledPlugins).toEqual([...OPTIONAL_PLUGINS_DEFAULT_OFF]);
    expect(out.optionalPluginsDefaultOff).toBe(true);
  });

  it("已有停用项去重合并,不丢用户既有选择", () => {
    const out = applyOptionalPluginsRetirement({ disabledPlugins: ["anim", "notify"], optionalPluginsDefaultOff: false });
    expect(out.disabledPlugins).toEqual(["anim", "notify", "ports", "intent-canvas"]);
  });

  it("二次执行(引用相等):用户插回后不被重新拔掉", () => {
    const once = applyOptionalPluginsRetirement({ disabledPlugins: [], optionalPluginsDefaultOff: false });
    const userReplugged = { ...once, disabledPlugins: once.disabledPlugins.filter((id) => id !== "anim") };
    const twice = applyOptionalPluginsRetirement(userReplugged);
    expect(twice).toBe(userReplugged);
    expect(twice.disabledPlugins).not.toContain("anim");
  });
});
