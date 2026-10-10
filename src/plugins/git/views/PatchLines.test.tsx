/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - unified:自绘经典红绿,旧/新双行号槽;mod 对词级实色块标注(与双栏同一
 *   配对同一 DP);全文态连续 ctx 折成胶囊条(与双栏同 FoldBar);
 * - split:中缝连接带四列(左内容 | 旧号 | 新号 | 右内容),对位由 buildSplitRows,
 *   这里验 色带与缺侧空带、词级实色块标注、行号槽居中缝两侧、改动行 seam 贯通、
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

  it("split:中缝排布 = 左内容 | 旧号 | 新号 | 右内容,改动行 seam 贯通", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 全部行号可达:ctx 10|20、mod 对 11|21、add 余量 ·|22
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // 行号槽居中缝两侧:同行 DOM 序 左内容 → 旧号 → 新号 → 右内容
    const leftCtx = html.indexOf(">ctx<");
    expect(leftCtx).toBeLessThan(html.indexOf(">10<"));
    expect(html.indexOf(">10<")).toBeLessThan(html.indexOf(">20<"));
    expect(html.indexOf(">20<")).toBeLessThan(html.indexOf(">ctx<", leftCtx + 1));
    // 修改对(左红右绿同行):band-del = 左号格+左内容;band-add = mod 右 + add 右(各号格+内容)
    expect(html.match(/git-split-band-del/g)?.length).toBe(2);
    expect(html.match(/git-split-band-add/g)?.length).toBe(4);
    // 缺侧空带:add 余量行左侧(号格+内容)浅绿
    expect(html.match(/git-split-empty-add/g)?.length).toBe(2);
    // mod 对词级实色块标注
    expect(html).toContain("git-split-word-del");
    expect(html).toContain("git-split-word-ins");
    // 中缝连接带:改动行(mod 对 + add 余量行)双号格 seam 各 2 格
    expect(html.match(/git-split-lno-seam/g)?.length).toBe(4);
  });

  it("split:纯删行右侧缺侧空带浅红", () => {
    const html = renderToStaticMarkup(
      createElement(PatchLines, { text: "@@ -5,2 +5,1 @@\n ctx\n-del\n", mode: "split" }),
    );
    expect(html.match(/git-split-empty-del/g)?.length).toBe(2); // 右号格 + 右内容
    expect(html.match(/git-split-lno-seam/g)?.length).toBe(2); // 纯删行双号格
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

  it("unified:mod 对词级实色块标注(与双栏同一配对同一 DP)", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "unified" }));
    expect(html).toContain("git-split-word-del");
    expect(html).toContain("git-split-word-ins");
    // 词级标注不扰乱行号槽与行序:del 仍在 add 前
    expect(html.indexOf(">11<")).toBeLessThan(html.indexOf(">21<"));
  });

  it("unified + fold:段内 ctx 行隐去(无胶囊),缺省不折,改动块永远渲染", () => {
    const patch = "@@ -1,7 +1,7 @@\n a\n b\n c\n-del\n+add1\n+add2\n+add3\n";
    const plain = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "unified" }));
    expect(plain).toContain(">a<");
    const folded = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "unified", fold: true }));
    expect(folded).not.toContain("git-split-fold"); // 就地胶囊已废,入口在头部工具条
    expect(folded).not.toContain(">a<"); // 段内 ctx 行整体隐去(行号跳变即信号)
    expect(folded).toContain(">del<"); // 改动块永远渲染
  });

  it("split + fold:段内 ctx 行隐去,缺省不折,改动块永远渲染", () => {
    const patch = "@@ -1,7 +1,7 @@\n a\n b\n c\n-del\n+add1\n+add2\n+add3\n";
    const plain = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "split" }));
    expect(plain).toContain(">a<");
    const folded = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "split", fold: true }));
    expect(folded).not.toContain("git-split-fold");
    expect(folded).not.toContain(">a<");
    expect(folded).toContain(">del<");
  });

  it("unified + path:Prism 静态上色(token span),无 path 纯转义", () => {
    const patch = '@@ -1,1 +1,1 @@\n const x = "s";\n';
    const plain = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "unified" }));
    expect(plain).not.toContain('class="token keyword');
    const lit = renderToStaticMarkup(createElement(PatchLines, { text: patch, mode: "unified", path: "a.ts" }));
    expect(lit).toContain('class="token keyword'); // const 关键字上色
    expect(lit).toContain('class="token string'); // 字符串字面量上色
  });
});
