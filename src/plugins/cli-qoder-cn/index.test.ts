/**
 * cli-qoder-cn(国内版)接线契约:分发渠道常量 + activate 注册的 profile 形状。
 * 与国际版同构,唯一差异是 QODER_CN_VARIANT 的三个常量 —— 全部在此锁死。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";
import { cliQoderCnPlugin, QODER_CN_VARIANT } from "./index";

describe("cli-qoder-cn 插件契约(国内版)", () => {
  it("分发渠道:qoderclicn + ~/.qoder-cn", () => {
    expect(QODER_CN_VARIANT).toEqual({
      profileId: "qoder-cn",
      command: "qoderclicn",
      dataDir: ".qoder-cn",
    });
  });

  it("activate 注册独立 CliProfile:触发符/resume/五向接线", () => {
    let profile: CliProfile | undefined;
    cliQoderCnPlugin.activate({
      registerCliProfile: (p: CliProfile) => {
        profile = p;
      },
    } as unknown as PluginContext);
    if (!profile) throw new Error("activate 未注册 profile");

    expect(profile.id).toBe("qoder-cn");
    expect(profile.command).toBe("qoderclicn");
    expect(profile.args).toEqual([]);
    expect(profile.triggers).toEqual([{ char: "/", kind: "command" }]);
    expect(profile.resumeArgs?.("abc-uuid")).toEqual(["--resume", "abc-uuid"]);
    expect(profile.listSessions).toBeDefined();
    expect(profile.readSessionStatus).toBeDefined();
    expect(profile.readSessionUserMessages).toBeDefined();
    expect(profile.readDefaultStatus).toBeDefined();
  });
});
