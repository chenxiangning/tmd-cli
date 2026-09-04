/**
 * cli-qoder(国际版)接线契约:分发渠道常量 + activate 注册的 profile 形状。
 * IO 行为(listSessions/status/锚点)由 cli-shared/qoderSessions 测试守护,此处只锁接线。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";
import { cliQoderPlugin, QODER_VARIANT } from "./index";

describe("cli-qoder 插件契约(国际版)", () => {
  it("分发渠道:qodercli + ~/.qoder", () => {
    expect(QODER_VARIANT).toEqual({
      profileId: "qoder",
      command: "qodercli",
      dataDir: ".qoder",
    });
  });

  it("activate 注册独立 CliProfile:触发符/resume/五向接线", () => {
    let profile: CliProfile | undefined;
    cliQoderPlugin.activate({
      registerCliProfile: (p: CliProfile) => {
        profile = p;
      },
    } as unknown as PluginContext);
    if (!profile) throw new Error("activate 未注册 profile");

    expect(profile.id).toBe("qoder");
    expect(profile.command).toBe("qodercli");
    expect(profile.args).toEqual([]);
    expect(profile.triggers).toEqual([
      { char: "/", kind: "command" },
      { char: "$", kind: "skill", translate: expect.any(Function) },
    ]);
    expect(profile.listSuggestions).toBeDefined();
    expect(profile.resumeArgs?.("abc-uuid")).toEqual(["--resume", "abc-uuid"]);
    expect(profile.listSessions).toBeDefined();
    expect(profile.readSessionStatus).toBeDefined();
    expect(profile.readSessionUserMessages).toBeDefined();
    expect(profile.readDefaultStatus).toBeDefined();
  });
});
