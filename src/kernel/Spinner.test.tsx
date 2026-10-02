/**
 * Spinner 契约(node renderToStaticMarkup,mock 手法同 DialogConfirm.test):
 * - span 骨架:role=status + aria-label 走 t("加载中"),className 并入不顶掉基类;
 * - 图标:Phosphor CircleNotch,size 透传 svg width/height(默认 0.75rem);
 * - 动画:内联 style 引全局 tmdSpin keyframes(1s linear infinite)。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));

import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("role=status + aria-label「加载中」,默认 0.75rem,tmdSpin 内联动画", () => {
    const html = renderToStaticMarkup(createElement(Spinner));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="加载中"');
    expect(html).toContain('class="inline-flex items-center"');
    expect(html).toContain('width="0.75rem"');
    expect(html).toContain("animation:tmdSpin 1s linear infinite");
  });

  it("size 覆写透传图标,className 并入基类之后", () => {
    const html = renderToStaticMarkup(
      createElement(Spinner, { size: "1rem", className: "align-middle" }),
    );
    expect(html).toContain('width="1rem"');
    expect(html).toContain('class="inline-flex items-center align-middle"');
  });
});
