/**
 * 发起会话 sheet 渲染契约(react-dom/server 静态渲染,模式同 GenSettings.test):
 * - 基座头:title 在场渲染 grabber/标题行/✕ 关闭钮,旧 .sheet-h 不再出现;
 * - 工作区整行选中(ws-opt,行尾对勾只在选中行);引擎双列卡片(eng-opt 全表);
 * - CTA 全宽新键「启动 {engine}」;blocked 态 = 提示卡在场、CTA 退场。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string, p?: Record<string, string>) =>
    p ? Object.entries(p).reduce((s, [name, v]) => s.replace(`{${name}}`, v), k) : k,
}));
vi.mock("@kernel/transport", () => ({ invoke: vi.fn(async () => ({ id: "s1" })) }));

const ctx = vi.hoisted(() => ({ useMobile: vi.fn() }));
vi.mock("./shared", () => ({ useMobile: () => ctx.useMobile() }));

import { SpawnSheet } from "./SpawnSheet";
import { ENGINES } from "./engines";

function render(): string {
  return renderToStaticMarkup(createElement(SpawnSheet, { onClose: () => undefined, onSpawned: () => undefined }));
}

describe("SpawnSheet 排布契约", () => {
  it("基座头 + 整行工作区 + 双列引擎卡片 + 全宽 CTA", () => {
    ctx.useMobile.mockReturnValue({
      workspaces: [
        { id: "w1", name: "alpha", root: "/a" },
        { id: "w2", name: "beta", root: "/b" },
      ],
      connected: true,
    });
    const html = render();
    /* 基座头:grabber/标题行/关闭钮;旧标题类与 280px 悬左 CTA 退场 */
    expect(html).toContain("sheet-grab");
    expect(html).toContain("sheet-titlebar");
    expect(html).toContain("sheet-x");
    expect(html).not.toContain('class="sheet-h"');
    expect(html).not.toContain("m-btn");
    /* 工作区:两行,首行选中;对勾 svg 只落在选中行 */
    const ws = [...html.matchAll(/class="ws-opt( on)?"/g)];
    expect(ws).toHaveLength(2);
    expect(ws.map((m) => m[1] ?? "")).toEqual([" on", ""]);
    expect(html.match(/m3\.5 8\.6/g)).toHaveLength(1);
    /* 引擎:全表卡片,唯一选中 */
    const eng = [...html.matchAll(/class="eng-opt( on)?"/g)];
    expect(eng).toHaveLength(ENGINES.length);
    expect(eng.filter((m) => m[1] === " on")).toHaveLength(1);
    /* CTA:新键「启动 {engine}」按选中引擎插参 */
    expect(html).toContain("sheet-cta");
    expect(html).toContain(`启动 ${ENGINES[0].name}`);
  });

  it("blocked 态:提示卡在场,CTA 退场", () => {
    ctx.useMobile.mockReturnValue({ workspaces: [], connected: false });
    const html = render();
    expect(html).toContain("sheet-alert warn");
    expect(html).not.toContain("sheet-cta");
  });

  it("冷启动分流:首拉未到(wsLoaded=false)不误报「还没有工作区」(2026-10-03 二轮)", () => {
    ctx.useMobile.mockReturnValue({ workspaces: [], wsLoaded: false, connected: true });
    const loading = render();
    expect(loading).toContain("正在获取工作区…");
    expect(loading).not.toContain("桌面还没有工作区");
    ctx.useMobile.mockReturnValue({ workspaces: [], wsLoaded: true, connected: true });
    const empty = render();
    expect(empty).toContain("桌面还没有工作区");
    expect(empty).not.toContain("正在获取工作区");
  });
});
