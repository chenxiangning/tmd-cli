/**
 * SearchOverlay 键盘导航呈现契约(node 环境 renderToStaticMarkup,ResultBody 测试缝):
 * 选中行唯一且带 data-sel;越界收口后不误选;无命中零选中;命中词 <mark> 高亮。
 * 按键分发(ArrowDown/Up/Enter)在组件 input,走桩目检。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { SessionSearchHit } from "./searchCore";
import { ResultBody } from "./SearchOverlay";

function hit(n: string, matchToken = "no-token", cwd = "/ws", workspaceId?: string): SessionSearchHit {
  return {
    entry: { profileId: "omp", cliSessionId: n, modifiedAt: 0, messages: [], cwd, workspaceId },
    snippet: `片段 ${n}`,
    matchToken,
    inTitle: false,
    subHits: [],
  };
}

const HITS = [hit("a"), hit("b"), hit("c")];

const base = { queryEmpty: false, indexing: false, index: null, onOpen: () => undefined, onOpenSub: () => undefined };

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

  it("命中词 <mark> 高亮:snippet 按命中词切三段拼节点", () => {
    const html = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        hits: [hit("k", "片段")],
        active: 0,
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain("<mark");
    expect(html).toContain("片段</mark> k");
  });
});

describe("ResultBody 跨工作区呈现(042)", () => {
  it("全部态命中行带工作区名 pill;本区态不显示", () => {
    const cross = hit("x", "no-token", "/ws2", "w2");
    const allHtml = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        hits: [cross],
        active: 0,
        onOpen: () => undefined,
        scopeAll: true,
        workspaceNameOf: (id) => (id === "w2" ? "tmd-cli" : undefined),
      }),
    );
    expect(allHtml).toContain("tmd-cli");
    const wsHtml = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        hits: [cross],
        active: 0,
        onOpen: () => undefined,
        scopeAll: false,
        workspaceNameOf: (id) => (id === "w2" ? "tmd-cli" : undefined),
      }),
    );
    expect(wsHtml).not.toContain("tmd-cli");
  });

  it("失效区命中:灰行(opacity-55)+「工作区已移走」pill", () => {
    const gone = hit("g", "no-token", "/gone", "w9");
    const html = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        hits: [gone],
        active: 0,
        onOpen: () => undefined,
        scopeAll: true,
        goneCwds: ["/gone"],
        workspaceNameOf: () => "hermes-old",
      }),
    );
    expect(html).toContain("opacity-55");
    expect(html).toContain("工作区已移走");
    expect(html).toContain("hermes-old");
  });

  it("空态双态:本区/全部文案可区分", () => {
    const emptyIndex = {
      cwd: "/ws",
      entries: [],
      scanned: 0,
      total: 0,
      listFailed: 0,
      workspacesTotal: 7,
      scannedWorkspaces: 7,
      goneCwds: [],
    };
    const wsHtml = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        index: emptyIndex,
        hits: [],
        active: 0,
        onOpen: () => undefined,
      }),
    );
    expect(wsHtml).toContain("此工作区未发现可检索的磁盘会话");
    const allHtml = renderToStaticMarkup(
      createElement(ResultBody, {
        ...base,
        index: emptyIndex,
        hits: [],
        active: 0,
        onOpen: () => undefined,
        scopeAll: true,
      }),
    );
    expect(allHtml).toContain("全部工作区都没有可检索的磁盘会话");
    expect(allHtml).not.toContain("此工作区未发现");
  });
});

/* ── 多命中展开(042 随手带):子命中 >1 出「N 处命中」展开钮 ────────── */

describe("ResultBody 多命中展开呈现(042)", () => {
  function multiHit(): SessionSearchHit {
    const h = hit("m");
    h.subHits = [
      { snippet: "第一处 归因", matchToken: "归因", message: "第一处 归因" },
      { snippet: "第二处 归因", matchToken: "归因", message: "第二处 归因" },
    ];
    return h;
  }

  it("子命中 >1:渲染「N 处命中」展开钮(初始折叠,子行不出)", () => {
    const html = renderToStaticMarkup(
      createElement(ResultBody, { ...base, hits: [multiHit()], active: 0 }),
    );
    expect(html).toContain("2 处命中");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("第一处 归因");
  });

  it("子命中 ≤1:无展开钮(单命中无需展开)", () => {
    const single = hit("s");
    single.subHits = [{ snippet: "唯一 归因", matchToken: "归因", message: "唯一 归因" }];
    const html = renderToStaticMarkup(
      createElement(ResultBody, { ...base, hits: [single], active: 0 }),
    );
    expect(html).not.toContain("处命中");
  });
});
