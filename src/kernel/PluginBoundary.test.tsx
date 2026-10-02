/**
 * PluginBoundary 渲染契约(node 环境 renderToStaticMarkup):
 * - 正常路径原样透传 children;
 * - 塌陷态呈现 = 可见的归属错误条(插件 id + 原因在场),不允许静默 null
 *   (深色主题下 null 等同整块黑屏,崩溃无从归因)。
 * SSR 不触发错误边界(渲染抛错直接上抛),塌陷态经子类置态驱动 render 分支。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const recordPluginCrash = vi.hoisted(() => vi.fn(() => false));
vi.mock("./pluginQuarantine", () => ({ recordPluginCrash }));

import { PluginBoundary } from "./PluginBoundary";

/** 强制塌陷态的探针子类:SSR 拿不到 componentDidCatch,直接置态钉呈现面。 */
class FailedBoundary extends PluginBoundary {
  override state = { failed: true, detail: "画布元素解析失败", gen: 0 };
}

describe("PluginBoundary", () => {
  it("正常路径原样透传 children,不计崩溃", () => {
    const html = renderToStaticMarkup(
      createElement(PluginBoundary, {
        pluginId: "intent-canvas",
        children: createElement("div", null, "画布管理页"),
      }),
    );
    expect(html).toContain("画布管理页");
    expect(recordPluginCrash).not.toHaveBeenCalled();
  });

  it("塌陷态渲染可见错误条:归属插件 id 与崩溃原因都在场", () => {
    const html = renderToStaticMarkup(
      createElement(FailedBoundary, {
        pluginId: "intent-canvas",
        children: createElement("div", null, "不应渲染"),
      }),
    );
    expect(html).toContain("intent-canvas");
    expect(html).toContain("画布元素解析失败");
    expect(html).toContain('role="alert"');
    /* 重试出口在场(贡献位可就地重挂,不必重启应用) */
    expect(html).toContain("重试该贡献位");
    expect(html).not.toContain("不应渲染");
  });
});
