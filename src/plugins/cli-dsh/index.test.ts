/**
 * cli-dsh 接线契约:分发渠道常量 + activate 注册的 profile / 设置 section 形状。
 * 对接口径移植自 codemoss(加固 npm 安装 + web host 启动),此处只锁接线;
 * host.describe 线格式与面板纯函数由 hostPanel.test.ts 守护。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";
import { cliDshPlugin, DSH_VARIANT } from "./index";

describe("cli-dsh 插件契约", () => {
  it("分发渠道:dsh + @deepseek-ai/dsh", () => {
    expect(DSH_VARIANT).toEqual({
      profileId: "dsh",
      command: "dsh",
      npmPackage: "@deepseek-ai/dsh",
    });
  });

  it("activate 注册 CliProfile:web host 启动 + 加固 npm 安装通道,会话读取不声明", () => {
    let profile: CliProfile | undefined;
    cliDshPlugin.activate({
      registerCliProfile: (p: CliProfile) => {
        profile = p;
      },
      registerSettingsSection: () => undefined,
    } as unknown as PluginContext);
    if (!profile) throw new Error("activate 未注册 profile");

    expect(profile.id).toBe("dsh");
    expect(profile.command).toBe("dsh");
    /* dsh 是 profile 启动器:会话即 `dsh web` 起本地 host。 */
    expect(profile.args).toEqual(["web"]);
    /* 磁盘会话体是 zstd 压缩流、触发符未实证:一律不声明(不猜接口)。 */
    expect(profile.triggers).toEqual([]);
    expect(profile.listSessions).toBeUndefined();
    expect(profile.resumeArgs).toBeUndefined();
    /* 加固安装参数(codemoss dsh_npm_install_args)+ npm 包仅查新版。 */
    expect(profile.scriptInstall?.unix).toContain(
      "npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest",
    );
    expect(profile.scriptInstall?.windows).toContain("@deepseek-ai/dsh@latest");
    expect(profile.npmPackage).toBe("@deepseek-ai/dsh");
  });

  it("activate 注册设置 section:连接面板单 tab", () => {
    let section: { id: string; tabs: { id: string; component: unknown }[] } | undefined;
    cliDshPlugin.activate({
      registerCliProfile: () => undefined,
      registerSettingsSection: (s: unknown) => {
        section = s as typeof section;
      },
    } as unknown as PluginContext);
    if (!section) throw new Error("activate 未注册设置 section");

    expect(section.id).toBe("dsh");
    expect(section.tabs.map((t) => t.id)).toEqual(["connection"]);
    expect(section.tabs[0].component).toBeDefined();
  });
});
