/**
 * engineMeta 安装计划派生单测 —— 通道优先级契约:script > command > npm。
 * omp 靠 command 通道走 bun install -g,npmPackage 仅作 registry 版本查询;
 * 优先级若回退成 npm,omp 会装进 npm 全局而绕过 bun 前置依赖(门控失效)。
 */

import { describe, expect, it } from "vitest";
import { installPlanOf, resolveInstallPlan } from "./engineMeta";

describe("installPlanOf 通道优先级", () => {
  it("scriptInstall 优先于 command 与 npm", () => {
    expect(
      installPlanOf({
        npmPackage: "a",
        commandInstall: { program: "bun", args: ["install", "-g", "a"] },
        scriptInstall: { unix: "u", windows: "w" },
      }),
    ).toEqual({ channel: "script", unix: "u", windows: "w" });
  });

  it("commandInstall 优先于 npm(omp 的 bun 安装通道)", () => {
    expect(
      installPlanOf({
        npmPackage: "@oh-my-pi/pi-coding-agent",
        commandInstall: {
          program: "bun",
          args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
        },
      }),
    ).toEqual({
      channel: "command",
      program: "bun",
      args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
    });
  });

  it("仅 npmPackage → npm 通道;全空 → null(不出安装按钮)", () => {
    expect(installPlanOf({ npmPackage: "x" })).toEqual({
      channel: "npm",
      package: "x",
    });
    expect(installPlanOf({})).toBeNull();
  });
});

describe("resolveInstallPlan 探针感知", () => {
  const ompMeta = {
    plan: installPlanOf({
      npmPackage: "@oh-my-pi/pi-coding-agent",
      commandInstall: {
        program: "bun",
        args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
      },
    }),
    npmPackage: "@oh-my-pi/pi-coding-agent",
  };

  it("命中 npm 拥有的副本 → npm 计划就地更新(omp 双副本场景)", () => {
    expect(
      resolveInstallPlan(ompMeta, {
        command: "omp",
        found: true,
        path: "C:\\Users\\x\\AppData\\Roaming\\npm\\omp.cmd",
        version: "omp/18.1.6",
        npmPrefix: "C:\\Users\\x\\AppData\\Roaming\\npm",
      }),
    ).toEqual({ channel: "npm", package: "@oh-my-pi/pi-coding-agent" });
  });

  it("命中非 npm 副本 / 未装 → 声明通道原样(bun-only 机器不变)", () => {
    const native = { npmPrefix: null };
    expect(resolveInstallPlan(ompMeta, { ...native } as never)).toEqual(ompMeta.plan);
    expect(resolveInstallPlan(ompMeta, null)).toEqual(ompMeta.plan);
  });

  it("声明 script 的引擎不被 npm 覆盖(官方脚本才管得了原生副本)", () => {
    const kimiMeta = {
      plan: installPlanOf({
        npmPackage: "@moonshot-ai/kimi-code",
        scriptInstall: { unix: "u", windows: "w" },
      }),
      npmPackage: "@moonshot-ai/kimi-code",
    };
    expect(
      resolveInstallPlan(kimiMeta, {
        npmPrefix: "C:\\npm",
      } as never),
    ).toEqual(kimiMeta.plan);
  });
});
