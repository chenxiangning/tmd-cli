import { describe, expect, it } from "vitest";
import { sanitize } from "./settingsSanitize";

/** 本地插件两个设置字段的清洗契约:缺省/非法一律回落默认,合法原样保留。 */
describe("sanitize 本地插件字段", () => {
  it("缺失或非法时回落默认:总开关关、信任表空", () => {
    for (const raw of [
      {},
      { localPluginsDisabled: "yes", localPluginTrust: "no" },
      { localPluginsDisabled: 1, localPluginTrust: [1] },
      null,
    ]) {
      const s = sanitize(raw);
      expect(s.localPluginsDisabled).toBe(false);
      expect(s.localPluginTrust).toEqual({});
    }
  });

  it("合法值原样保留", () => {
    const s = sanitize({
      localPluginsDisabled: true,
      localPluginTrust: { hello: ["a1b2c3", "ff00ff"] },
    });
    expect(s.localPluginsDisabled).toBe(true);
    expect(s.localPluginTrust).toEqual({ hello: ["a1b2c3", "ff00ff"] });
  });

  it("信任表逐条清洗:坏 id/坏 hash 项丢弃,合法项保留", () => {
    const s = sanitize({
      localPluginTrust: {
        good: ["abc", 42, "def", ""],
        "": ["abc"],
        bad: "not-array",
      } as unknown,
    });
    expect(s.localPluginTrust).toEqual({ good: ["abc", "def"] });
  });
});
