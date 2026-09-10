/**
 * EngineCard(终端行)渲染契约测试(node 环境 renderToStaticMarkup):
 * - 落后:版本列显 "→ <latest>" + 「更新」按钮 pri 高亮;
 * - 已最新:「重装」按钮(同 onInstall,无高亮);
 * - 查询失败(null)/查询中(undefined):不渲染最新版;
 * - 未安装(notFound):即使拿到最新版也不渲染(行只显示「安装」);
 * - 前置依赖(omp → bun):依赖未就位时主引擎安装/更新按钮禁用 + 引导区;
 *   依赖探针 ok 后门控解除;
 * - 已安装行常驻「新会话」按钮,未安装行不出。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EngineCard, type EngineProbeState, type InstallState } from "./EngineCard";
import type { EngineMeta, PrerequisiteMeta } from "./engineMeta";

/* 内联 meta 字面量(派生自 profile 后不再有静态表可引)。 */
const META: EngineMeta = {
  id: "omp",
  displayName: "OMP",
  binary: "omp",
  docsUrl: "https://github.com/oh-my-pi/pi-coding-agent",
  installHint: "bun install -g @oh-my-pi/pi-coding-agent",
  npmPackage: "@oh-my-pi/pi-coding-agent",
  plan: {
    channel: "command",
    program: "bun",
    args: ["install", "-g", "@oh-my-pi/pi-coding-agent"],
  },
};

/* 前置依赖字面量(派生自 profile.requires 后不再有静态表可引)。 */
const REQUIRES: PrerequisiteMeta = {
  binary: "bun",
  name: "Bun",
  docsUrl: "https://bun.sh",
  installHint: "curl -fsSL https://bun.sh/install | bash",
  plan: { channel: "script", unix: "u", windows: "w" },
};

const META_WITH_REQ: EngineMeta = { ...META, requires: REQUIRES };

const IDLE_INSTALL: InstallState = { running: false, ok: null, lines: [] };

function probeOk(version: string): EngineProbeState {
  return {
    status: "ok",
    result: { command: "omp", found: true, path: "/usr/local/bin/omp", version },
  };
}

function renderCard(
  probe: EngineProbeState,
  latest: string | null | undefined,
  overrides?: { meta?: EngineMeta; depProbe?: EngineProbeState },
): string {
  return renderToStaticMarkup(
    createElement(EngineCard, {
      meta: overrides?.meta ?? META,
      profile: undefined,
      probe,
      latest,
      install: IDLE_INSTALL,
      onProbe: () => {},
      onInstall: () => {},
      depProbe: overrides?.depProbe,
      depInstall: IDLE_INSTALL,
      onDepInstall: () => {},
      onDepProbe: () => {},
      creds: undefined,
      expanded: false,
      onToggleExpand: () => {},
      cursor: false,
      onCursor: () => {},
      onNewSession: () => {},
    }),
  );
}

describe("EngineCard 版本列与动作按钮", () => {
  it("落后:渲染 → 最新版 + 「更新」pri 高亮", () => {
    const html = renderCard(probeOk("omp/18.0.11"), "18.1.2");
    expect(html).toContain("omp/18.0.11");
    expect(html).toContain("→18.1.2");
    expect(html).toContain("welcome-ab pri");
    expect(html).toContain("更新");
    expect(html).toContain("更新到 18.1.2");
  });

  it("已最新:出「重装」按钮,无 pri 高亮", () => {
    const html = renderCard(probeOk("0.84.4"), "0.84.4");
    expect(html).toContain(">重装<");
    expect(html).not.toContain("welcome-ab pri");
  });

  it.each([
    ["查询失败", null],
    ["查询中", undefined],
  ])("%s:不渲染最新版箭头", (_label, latest) => {
    const html = renderCard(probeOk("omp/18.0.11"), latest);
    expect(html).not.toContain("→");
    expect(html).not.toContain("welcome-ab pri");
  });

  it("未安装:有最新版数据也不渲染(只显示安装按钮)", () => {
    const html = renderCard({ status: "notFound", result: null }, "18.1.2");
    expect(html).toContain("未安装");
    expect(html).not.toContain("18.1.2");
    expect(html).toContain(">安装<");
    /* 未安装行不出「新会话」按钮。 */
    expect(html).not.toContain("新会话");
  });

  it("已安装:行常驻「新会话」按钮", () => {
    const html = renderCard(probeOk("1.0.0"), "1.0.0");
    expect(html).toContain("新会话");
  });
});

describe("EngineCard 前置依赖门控(omp → bun)", () => {
  const notFound: EngineProbeState = { status: "notFound", result: null };

  function depOk(version: string): EngineProbeState {
    return {
      status: "ok",
      result: { command: "bun", found: true, path: "~/.bun/bin/bun", version },
    };
  }

  it("依赖未装:主安装按钮禁用并提示先安装,引导区出「安装 Bun」按钮", () => {
    const html = renderCard(notFound, undefined, {
      meta: META_WITH_REQ,
      depProbe: notFound,
    });
    expect(html).toContain("依赖 Bun 运行时");
    expect(html).toContain(">安装 Bun</button>");
    expect(html).toContain('title="先安装 Bun"');
    /* 主安装按钮(引导区按钮不带 disabled):disabled 恰好挂在行内主按钮上。 */
    expect(html).toMatch(/class="welcome-ab" disabled/);
  });

  it("依赖探针中:主按钮保守禁用,引导区只出状态文案", () => {
    const html = renderCard(notFound, undefined, {
      meta: META_WITH_REQ,
      depProbe: { status: "loading", result: null },
    });
    expect(html).toContain("探针前置依赖 Bun");
    expect(html).not.toContain(">安装 Bun</button>");
    expect(html).toMatch(/class="welcome-ab" disabled/);
  });

  it("依赖就绪:门控解除,引导区整块消失", () => {
    const html = renderCard(notFound, undefined, {
      meta: META_WITH_REQ,
      depProbe: depOk("1.2.3"),
    });
    expect(html).not.toContain("welcome-prereq");
    expect(html).not.toContain("先安装");
    expect(html).not.toMatch(/class="welcome-ab" disabled/);
  });

  it("依赖探针失败:出重探按钮,主按钮仍禁用", () => {
    const html = renderCard(notFound, undefined, {
      meta: META_WITH_REQ,
      depProbe: { status: "error", result: null },
    });
    expect(html).toContain("前置依赖 Bun 探针失败");
    expect(html).toContain("重新探针前置依赖");
    expect(html).toMatch(/class="welcome-ab" disabled/);
  });

  it("无 requires 声明的引擎:不受门控(安装按钮可点,无引导区)", () => {
    const html = renderCard(notFound, undefined, { depProbe: notFound });
    expect(html).not.toContain("welcome-prereq");
    expect(html).not.toMatch(/class="welcome-ab" disabled/);
  });
});
