/**
 * 幕布保底刷新钮渲染契约(node 环境 renderToStaticMarkup,同 PluginBoundary 惯例):
 * - 自救语义可发现:title 提示在场(i18n 键即文案,缺失即"隐形按钮"回归);
 * - 纯点缀组件:不触碰字节流,无 PTY 依赖。
 * 点击 → location.reload 的行为语义(会话跨重载存活)是架构契约
 * (docs/architecture/17-render-health.md),不在 node 环境单测覆盖面内。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TerminalRefreshButton } from "./terminalRefreshButton";

describe("TerminalRefreshButton 渲染契约", () => {
  it("按钮渲染为带自救提示的图标钮(右上角常驻出口)", () => {
    const markup = renderToStaticMarkup(createElement(TerminalRefreshButton));
    expect(markup).toContain("<button");
    expect(markup).toContain("刷新界面");
    expect(markup).toContain("会话不中断");
    /* 初态可击发:disabled 通道未钉死(击发后才钉,防连点叠发 reload) */
    expect(markup).not.toContain("disabled");
  });
});
