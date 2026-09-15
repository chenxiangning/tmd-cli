/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - unified:自绘经典红绿,旧/新双行号槽;
 * - split:GitHub 风四列(旧号 | 左内容 | 新号 | 右内容),对位由 buildSplitRows,
 *   这里验 色带与缺侧空带、词级实色块标注、行号槽各半内侧缘、
 *   nowrap 态左右独立横向滚动面 + 双号槽纵同步栈。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PatchLines } from "./PatchLines";
import { parsePatch, patchRowKey } from "./patchModel";
import { setGitDiffWrap } from "../panelStore";

/* ctx old10/new20 + mod 对 del old11 × add new21 + add 余量 new22 */
const PATCH = "@@ -10,1 +20,2 @@\n ctx\n-del\n+addA\n+addB\n";

describe("PatchLines", () => {
  it("unified:双行号槽各归其位", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "unified" }));
    // ctx 双号;del 旧号槽 11;add 新号槽 21/22
    for (const n of [10, 20, 11, 21, 22]) expect(html).toContain(`>${n}<`);
    expect(html).toContain("@@ -10,1 +20,2 @@"); // hunk 头通栏
  });

  it("split:GitHub 排布 = 旧号 | 左内容 | 新号 | 右内容,色带/空带/词级按配对语义", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 全部行号可达:ctx 10|20、mod 对 11|21、add 余量 ·|22
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // 行号槽在各半内侧缘:同行 DOM 序 旧号 → 左内容 → 新号
    const ctxRow = html.indexOf(">10<");
    expect(ctxRow).toBeLessThan(html.indexOf(">ctx<"));
    expect(html.indexOf(">ctx<")).toBeLessThan(html.indexOf(">20<"));
    // 修改对(左红右绿同行):band-del = 左号格+左内容;band-add = mod 右 + add 右(各号格+内容)
    expect(html.match(/git-split-band-del/g)?.length).toBe(2);
    expect(html.match(/git-split-band-add/g)?.length).toBe(4);
    // 缺侧空带:add 余量行左侧(号格+内容)浅绿
    expect(html.match(/git-split-empty-add/g)?.length).toBe(2);
    // mod 对词级实色块标注
    expect(html).toContain("git-split-word-del");
    expect(html).toContain("git-split-word-ins");
  });

  it("split:纯删行右侧缺侧空带浅红", () => {
    const html = renderToStaticMarkup(
      createElement(PatchLines, { text: "@@ -5,2 +5,1 @@\n ctx\n-del\n", mode: "split" }),
    );
    expect(html.match(/git-split-empty-del/g)?.length).toBe(2); // 右号格 + 右内容
  });
  it("默认 mode = unified", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
    expect(html).toContain(">21<");
    expect(html).not.toContain("git-split-lno"); // 未走双栏
  });

  it("自动换行关闭:双栏切左右独立横向滚动面", () => {
    const on = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    expect(on.match(/overflow-auto/g)?.length).toBe(1); // 仅外层 pre 一个滚动面
    setGitDiffWrap(false);
    try {
      const off = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
      // halves 态:左右两 overflow-auto 内容滚动面 + 双号槽栈 overflow-hidden(含外层 pre 共 3)
      expect(off.match(/overflow-auto/g)?.length).toBe(2);
      expect(off.match(/overflow-hidden/g)?.length).toBe(3);
      expect(off).toContain("git-split-lno");
      const unifiedNowrap = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
      expect(unifiedNowrap).toContain("whitespace-pre ");
    } finally {
      setGitDiffWrap(true); // 模块级单例,回置防串其他用例
    }
  });

  it("双 No-newline meta 行 key 唯一(内容序数去重,不用数组下标)", () => {
    const patch = [
      "@@ -1 +1 @@",
      "-old",
     ("\\ No newline at end of file"),
      "+new",
     ("\\ No newline at end of file"),
    ].join("\n");
    const keys = parsePatch(patch).map(patchRowKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
