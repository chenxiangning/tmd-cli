/**
 * cli-dsh 接线契约:分发渠道常量 + activate 注册的 profile / homePanel 形状。
 * 对接口径移植自 codemoss(加固 npm 安装 + web host 启动),此处只锁接线;
 * host.describe 线格式与面板纯函数由 dshHost.test.ts 守护。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";
import { cliDshPlugin, DSH_VARIANT } from "./index";
import { DshHostPanel } from "./hostPanel";
import { DshCanvas } from "./dshCanvas";

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
      registerHomePanel: () => undefined,
      registerSessionCanvas: () => undefined,
    } as unknown as PluginContext);
    if (!profile) throw new Error("activate 未注册 profile");

    expect(profile.id).toBe("dsh");
    expect(profile.command).toBe("dsh");
    /* dsh 是 profile 启动器:会话即 `dsh web` 起本地 host。 */
    expect(profile.args).toEqual(["web", "--no-open"]);
    /* 会话即 host:单实例语义,create 撞活会话聚焦既有(kernel 契约)。 */
    expect(profile.singleInstance).toBe(true);
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

  it("连接面板经 registerHomePanel 上卡、中央面经 registerSessionCanvas 登记,不注册设置 section", () => {
    let panelId: string | undefined;
    let panel: unknown;
    let sectionRegistered = false;
    let canvasId: string | undefined;
    let canvas: unknown;
    cliDshPlugin.activate({
      registerCliProfile: () => undefined,
      registerHomePanel: (id: string, component: unknown) => {
        panelId = id;
        panel = component;
      },
      registerSessionCanvas: (id: string, component: unknown) => {
        canvasId = id;
        canvas = component;
      },
      registerSettingsSection: () => {
        sectionRegistered = true;
      },
    } as unknown as PluginContext);
    expect(panelId).toBe("dsh");
    expect(panel).toBe(DshHostPanel);
    expect(sectionRegistered).toBe(false);
    /* dsh 无 TUI:会话中央区注册 host Web UI 内嵌面。 */
    expect(canvasId).toBe("dsh");
    expect(canvas).toBe(DshCanvas);
  });
});
