/**
 * EngineCard 最新版本渲染契约测试(node 环境 renderToStaticMarkup):
 * - 落后:渲染 "→ <latest>" pill + 更新按钮 has-update 高亮;
 * - 已最新:渲染 muted "已是最新";
 * - 查询失败(null)/查询中(undefined):不渲染任何最新版 pill;
 * - 未安装(notFound):即使拿到最新版也不渲染(卡片只显示"安装")。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { EngineCard, type EngineProbeState, type InstallState } from "./EngineCard";
import { ENGINE_META_BY_ID } from "./engineMeta";

const META = ENGINE_META_BY_ID.omp;

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
): string {
  return renderToStaticMarkup(
    createElement(EngineCard, {
      meta: META,
      profile: undefined,
      probe,
      latest,
      install: IDLE_INSTALL,
      onProbe: () => {},
      onInstall: () => {},
    }),
  );
}

describe("EngineCard 最新版本 pill", () => {
  it("落后:渲染 → 最新版 pill,更新按钮带 has-update", () => {
    const html = renderCard(probeOk("omp/18.0.11"), "18.1.2");
    expect(html).toContain("omp/18.0.11");
    expect(html).toContain("→ 18.1.2");
    expect(html).toContain("is-outdated");
    expect(html).toContain("has-update");
    expect(html).toContain("更新到 18.1.2");
  });

  it("已最新:渲染 muted 已是最新,更新按钮无高亮", () => {
    const html = renderCard(probeOk("0.84.4"), "0.84.4");
    expect(html).toContain("已是最新");
    expect(html).toContain("is-latest");
    expect(html).not.toContain("has-update");
  });

  it.each([
    ["查询失败", null],
    ["查询中", undefined],
  ])("%s:不渲染最新版 pill", (_label, latest) => {
    const html = renderCard(probeOk("omp/18.0.11"), latest);
    expect(html).not.toContain("is-outdated");
    expect(html).not.toContain("is-latest");
    expect(html).not.toContain("has-update");
  });

  it("未安装:有最新版数据也不渲染(只显示安装按钮)", () => {
    const html = renderCard(
      { status: "notFound", result: null },
      "18.1.2",
    );
    expect(html).toContain("未安装");
    expect(html).not.toContain("18.1.2");
    expect(html).not.toContain("is-outdated");
  });
});
