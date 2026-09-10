/**
 * cli-dsh 接线契约:分发渠道常量 + activate 注册的 profile / homePanel 形状。
 * 对接口径移植自 codemoss(加固 npm 安装 + web host 启动),此处只锁接线;
 * host.describe 线格式与面板纯函数由 dshHost.test.ts 守护。
 */

import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { PluginContext } from "@kernel/plugin";
import { cliDshPlugin, DSH_VARIANT } from "./plugin";
import { DshHostPanel } from "./hostPanel";

describe("cli-dsh 插件契约", () => {
  it("分发渠道:dsh + @deepseek-ai/dsh", () => {
    expect(DSH_VARIANT).toEqual({
      profileId: "dsh",
      command: "dsh",
      npmPackage: "@deepseek-ai/dsh",
    });
  });

  it("activate 注册 CliProfile:适配器 spawn + 审批卡标记 + 加固 npm 安装通道", () => {
    let profile: CliProfile | undefined;
    cliDshPlugin.activate({
      registerCliProfile: (p: CliProfile) => {
        profile = p;
      },
      registerSettingsSection: () => undefined,
      registerHomePanel: () => undefined,
    } as unknown as PluginContext);
    if (!profile) throw new Error("activate 未注册 profile");

    expect(profile.id).toBe("dsh");
    expect(profile.command).toBe("dsh");
    /* 会话 = PTY 跑适配器脚本(host-RPC 第二客户端),非 `dsh web` 本体。 */
    expect(profile.spawnTransform).toBeTypeOf("function");
    /* 审批/提问卡片:适配器输出标记经 askWatch 检测。 */
    expect(profile.askMarks).toEqual([/\[DSH 审批\]/, /\[DSH 提问\]/]);
    /* 多会话允许:每会话独立 DSH workspace+session,单实例语义已废。 */
    expect(profile.singleInstance).toBeUndefined();
    /* 触发符未实证:不声明(不猜接口)。 */
    expect(profile.triggers).toEqual([]);
    /* 磁盘历史经 host RPC 代读(zstd 盘 fs 读不了);resume 标记由 spawnTransform 翻接。 */
    expect(profile.listSessions).toBeTypeOf("function");
    expect(profile.resumeArgs?.("session-abc")).toEqual(["--resume", "session-abc"]);
    expect(profile.readSessionStatus).toBeTypeOf("function");
    /* 工具栏「思考」位点击契约:发 /effort 开强度菜单。 */
    expect(profile.thinkingCommand).toBe("/effort");
    expect(profile.fetchQuota).toBeTypeOf("function");
    /* 加固安装参数(codemoss dsh_npm_install_args)+ npm 包仅查新版。 */
    expect(profile.scriptInstall?.unix).toContain(
      "npm i -g --maxsockets=1 --fetch-retries=5 --no-audit --no-fund @deepseek-ai/dsh@latest",
    );
    expect(profile.scriptInstall?.windows).toContain("@deepseek-ai/dsh@latest");
    expect(profile.npmPackage).toBe("@deepseek-ai/dsh");
  });

  it("连接面板经 ctx.registerHomePanel 上卡(键 = profile id),不再注册设置 section", () => {
    let panelId: string | undefined;
    let panel: unknown;
    let sectionRegistered = false;
    cliDshPlugin.activate({
      registerCliProfile: () => undefined,
      registerHomePanel: (id: string, component: unknown) => {
        panelId = id;
        panel = component;
      },
      registerSettingsSection: () => {
        sectionRegistered = true;
      },
    } as unknown as PluginContext);

    expect(panelId).toBe("dsh");
    expect(panel).toBe(DshHostPanel);
    expect(sectionRegistered).toBe(false);
  });
});
