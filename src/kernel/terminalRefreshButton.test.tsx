/**
 * 幕布刷新钮渲染契约(node 环境 renderToStaticMarkup,同 PluginBoundary 惯例):
 * - 自救语义可发现:title 提示在场(i18n 键即文案,缺失即"隐形按钮"回归);
 * - 受控组件:重建动作由 TerminalView 的 canvasGen 代数承担(onClick 注入,
 *   本件零自有状态);点击 → 重建链(xterm 重挂 + 回放 + 强制 SIGWINCH)是
 *   TerminalView effect 契约,不在 node 环境单测覆盖面内。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { TerminalRefreshButton } from "./terminalRefreshButton";

describe("TerminalRefreshButton 渲染契约", () => {
  it("按钮渲染为与转录浮标同款样式的文本钮「刷新」,onClick 直通无拦截", () => {
    const onClick = vi.fn();
    const markup = renderToStaticMarkup(
      createElement(TerminalRefreshButton, { onClick }),
    );
    expect(markup).toContain("<button");
    expect(markup).toContain("刷新幕布");
    expect(markup).toContain("PTY 不中断");
    /* 可见标签 = 文本「刷新」(与 .lv-pill 文本形制配套,非图标钮) */
    expect(markup).toContain(">刷新</button>");
    /* 重建幂等可重复触发,无 disabled 静默面 */
    expect(markup).not.toContain("disabled");
    expect(onClick).not.toHaveBeenCalled();
  });
});
