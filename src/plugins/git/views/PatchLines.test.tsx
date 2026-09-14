/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - unified:自绘经典红绿,旧/新双行号槽;
 * - split:react-diff-view(Diff viewType="split"),对位与占位由库负责,
 *   这里只验 删/增/上下文 行 class 与 gutter 行号可达。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PatchLines } from "./PatchLines";
import { setGitDiffWrap } from "../panelStore";

/* ctx old10/new20 + del old11 + add new21 + add new22(右余量一行) */
const PATCH = "@@ -10,1 +20,2 @@\n ctx\n-del\n+addA\n+addB\n";

describe("PatchLines", () => {
  it("unified:双行号槽各归其位", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "unified" }));
    // ctx 双号;del 旧号槽 11;add 新号槽 21/22
    for (const n of [10, 20, 11, 21, 22]) expect(html).toContain(`>${n}<`);
    expect(html).toContain("@@ -10,1 +20,2 @@"); // hunk 头通栏
  });

  it("split:react-diff-view 呈现删/增/上下文与行号", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 库的结构标记
    expect(html).toContain("diff-split");
    expect(html).toContain("diff-code-delete");
    expect(html).toContain("diff-code-insert");
    expect(html).toContain("diff-gutter-insert");
    // 行号可达:删除旧号 11、插入新号 21/22、上下文 10/20
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // zip 后 del 行与首个 add 行成对出现在同一 compare 行
    expect(html).toContain("diff-line-compare");
  });

  it("默认 mode = unified", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
    expect(html).toContain(">21<");
    expect(html).not.toContain("diff-split"); // 未走 react-diff-view
  });

  it("自动换行开关作用于双栏 wrap 类", () => {
    const on = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    expect(on).toContain("git-diff-rdv-wrap");
    setGitDiffWrap(false);
    try {
      const off = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
      expect(off).not.toContain("git-diff-rdv-wrap");
      const unifiedNowrap = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
      expect(unifiedNowrap).toContain("whitespace-pre ");
    } finally {
      setGitDiffWrap(true); // 模块级单例,回置防串其他用例
    }
  });
});
