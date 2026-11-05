/**
 * engineMeta 安装计划派生单测 —— 通道优先级契约:script > command > npm。
 * omp 靠 command 通道走 bun install -g,npmPackage 仅作 registry 版本查询;
 * 优先级若回退成 npm,omp 会装进 npm 全局而绕过 bun 前置依赖(门控失效)。
 */

import {
  installPlanOf,
  pinPlanVersion,
  pinPrerequisiteVersion,
  resolveInstallPlan,
} from "./engineMeta";
import { describe, expect, it } from "vitest";

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

  it("命中非 npm 原生副本 + 声明 commandUpdate → 命令通道就地自更新(qoder 原生目录)", () => {
    const qoderMeta = {
      plan: installPlanOf({ npmPackage: "@qoder-ai/qodercli" }),
      npmPackage: "@qoder-ai/qodercli",
      commandUpdate: { program: "qodercli", args: ["update"] },
    };
    expect(
      resolveInstallPlan(qoderMeta, {
        command: "qodercli",
        found: true,
        path: "/Users/x/.local/bin/qodercli",
        version: "1.1.56",
        npmPrefix: null,
      }),
    ).toEqual({ channel: "command", program: "qodercli", args: ["update"] });
    /* 未装:自更新通道不接管,安装仍走声明通道(未装机器没有该二进制)。 */
    expect(resolveInstallPlan(qoderMeta, null)).toEqual(qoderMeta.plan);
  });

  it("声明 script 也被 npm 副本接管:就地更新探针看到的那份(2026-11-06 win 实证 bun)", () => {
    const bunDep = {
      plan: installPlanOf({
        npmPackage: "bun",
        scriptInstall: {
          unix: "curl -fsSL https://bun.sh/install | bash",
          windows: "irm bun.sh/install.ps1|iex",
        },
      }),
      npmPackage: "bun",
    };
    /* 探针命中 %APPDATA%\npm 的 bun@1.4.0:官方脚本只写 ~/.bun/bin,
     * 一键修复后过旧横幅不消失 → npm --prefix 就地更新命中的这份。 */
    expect(
      resolveInstallPlan(bunDep, {
        command: "bun",
        found: true,
        path: "C:\\Users\\x\\AppData\\Roaming\\npm\\bun.cmd",
        version: "1.4.0",
        npmPrefix: "C:\\Users\\x\\AppData\\Roaming\\npm",
      }),
    ).toEqual({ channel: "npm", package: "bun" });
    /* 命中原生副本(~/.bun/bin)→ 官方脚本照旧;未装 → 声明 script。 */
    expect(
      resolveInstallPlan(bunDep, {
        command: "bun",
        found: true,
        path: "C:\\Users\\x\\.bun\\bin\\bun.exe",
        version: "1.4.4",
        npmPrefix: null,
      }),
    ).toEqual(bunDep.plan);
    expect(resolveInstallPlan(bunDep, null)).toEqual(bunDep.plan);
  });
});

describe("pinPlanVersion 钉版安装计划", () => {
  const bunPlan = installPlanOf({
    npmPackage: "@oh-my-pi/pi-coding-agent",
    commandInstall: {
      program: "bun",
      args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
    },
  });

  it("command 通道:args 中包名替换为 pkg@version,其余原样", () => {
    expect(pinPlanVersion(bunPlan, "@oh-my-pi/pi-coding-agent", "18.1.20")).toEqual({
      channel: "command",
      program: "bun",
      args: ["install", "-g", "@oh-my-pi/pi-coding-agent@18.1.20"],
    });
  });

  it("非 command 通道(npm/script)无法钉版 → null", () => {
    expect(pinPlanVersion({ channel: "npm", package: "x" }, "x", "1.0.0")).toBeNull();
    expect(
      pinPlanVersion({ channel: "script", unix: "u", windows: "w" }, "x", "1.0.0"),
    ).toBeNull();
  });

  it("未声明 npmPackage / args 不含包名 → null(不盲改参数)", () => {
    expect(pinPlanVersion(bunPlan, undefined, "18.1.20")).toBeNull();
    expect(
      pinPlanVersion(
        { channel: "command", program: "bun", args: ["install", "-g"] },
        "@oh-my-pi/pi-coding-agent",
        "18.1.20",
      ),
    ).toBeNull();
  });
});

describe("pinPrerequisiteVersion 依赖钉版", () => {
  const requires = {
    binary: "bun",
    name: "Bun",
    installHint: "install",
    plan: { channel: "script", unix: "u", windows: "w" },
    versionMenu: true,
    npmPackage: "bun",
    scriptVersionInstall: {
      unix: 'bash -s "bun-v{version}"',
      windows: "install -Version {version}",
    },
  } satisfies Parameters<typeof pinPrerequisiteVersion>[0];

  it("双平台模板均替换版本号,保留 script 通道", () => {
    expect(pinPrerequisiteVersion(requires, "1.4.4")).toEqual({
      channel: "script",
      unix: 'bash -s "bun-v1.4.4"',
      windows: "install -Version 1.4.4",
    });
  });

  it("命中 npm 副本 → npm 就地钉版(探针/菜单看到的副本才是更新目标)", () => {
    expect(
      pinPrerequisiteVersion(requires, "1.4.5", {
        command: "bun",
        found: true,
        path: "C:\\Users\\x\\AppData\\Roaming\\npm\\bun.cmd",
        version: "1.4.0",
        npmPrefix: "C:\\Users\\x\\AppData\\Roaming\\npm",
      }),
    ).toEqual({ channel: "npm", package: "bun", version: "1.4.5" });
  });

  it("命中原生副本 / 未传探针 → 官方 script 模板钉版", () => {
    const scriptPlan = {
      channel: "script",
      unix: 'bash -s "bun-v1.4.4"',
      windows: "install -Version 1.4.4",
    };
    expect(
      pinPrerequisiteVersion(requires, "1.4.4", {
        command: "bun",
        found: true,
        path: "C:\\Users\\x\\.bun\\bin\\bun.exe",
        version: "1.4.4",
        npmPrefix: null,
      }),
    ).toEqual(scriptPlan);
    expect(pinPrerequisiteVersion(requires, "1.4.4", null)).toEqual(scriptPlan);
  });

  it("未开启、非 script 或任一平台缺占位符 → null", () => {
    expect(pinPrerequisiteVersion({ ...requires, versionMenu: false }, "1.4.4")).toBeNull();
    expect(
      pinPrerequisiteVersion(
        { ...requires, plan: { channel: "npm", package: "bun" } },
        "1.4.4",
      ),
    ).toBeNull();
    expect(
      pinPrerequisiteVersion(
        {
          ...requires,
          scriptVersionInstall: { unix: "bash", windows: "install -Version {version}" },
        },
        "1.4.4",
      ),
    ).toBeNull();
  });
});
