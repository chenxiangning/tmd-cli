/**
 * SearchOverlay 键盘导航呈现契约(node 环境 renderToStaticMarkup,ResultBody 测试缝):
 * 选中行唯一且带 data-sel;越界收口后不误选;无命中零选中。
 * 按键分发(ArrowDown/Up/Enter)在组件 input,走桩目检。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { SessionSearchHit } from "./indexer";
import { ResultBody } from "./SearchOverlay";

function hit(n: string): SessionSearchHit {
  return {
    entry: { profileId: "omp", cliSessionId: n, modifiedAt: 0, messages: [] },
    snippet: `片段 ${n}`,
    inTitle: false,
  };
}

const HITS = [hit("a"), hit("b"), hit("c")];

const base = { queryEmpty: false, indexing: false, index: null };

describe("ResultBody 选中呈现", () => {
  it("active 行带 data-sel 且唯一", () => {
    const html = renderToStaticMarkup(
      createElement(ResultBody, { ...base, hits: HITS, active: 1, onOpen: () => undefined }),
    );
    expect(html.match(/data-sel="true"/g)).toHaveLength(1);
    expect(html.indexOf("片段 b")).toBeLessThan(html.indexOf("片段 c"));
    const selPos = html.indexOf('data-sel="true"');
    expect(selPos).toBeGreaterThan(html.indexOf("片段 a"));
    expect(selPos).toBeLessThan(html.indexOf("片段 c"));
  });

  it("无命中零选中(收口后 active=-1 也不渲染 data-sel)", () => {
    const html = renderToStaticMarkup(
      createElement(ResultBody, { ...base, hits: [], active: -1, onOpen: () => undefined }),
    );
    expect(html).not.toContain("data-sel");
  });
});
