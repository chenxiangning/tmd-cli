/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - split(并排):中央行号槽(旧|新)、同行红绿对位(修改对左格 del 带 + 右格 add 带)、
 *   纯删/纯增单侧带;配对行词级下划线;空侧留白(无斜纹);hunk 头通栏。
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

  it("split:中央槽旧|新行号,色带与词级标注按配对语义", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 全部行号可达:ctx 10|20、mod 对 11|21、add 余量 ·|22
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // 修改对(左红右绿同行):band-del 左格 ×1 + band-add 右格 ×1;add 余量蓝带 +1
    expect(html.match(/git-split-band-del/g)?.length).toBe(1);
    expect(html.match(/git-split-band-add/g)?.length).toBe(2);
    // mod 对词级:左删标注 + 右增标注(下划线,非色块)
    expect(html).toContain("git-split-word-del");
    expect(html).toContain("git-split-word-ins");
    // 空侧留白(斜纹已废)
    expect(html).not.toContain("diff-split-empty");
    // IDEA 式块标记与占位:块行 data-block-id + 缺侧类型色块;改动行旧号 ⤶ 钩
    expect(html.match(/data-block-id/g)?.length).toBe(2); // mod 对 + add 余量,ctx 不属块
    expect(html).toContain("git-split-ph-add"); // add 余量行左槽占位色块
    expect(html).toContain("git-split-ghook");
    expect(html.match(/git-split-gslot-empty/g)?.length).toBe(1);
  });

  it("默认 mode = unified", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
    expect(html).not.toContain("diff-split-empty");
    expect(html).toContain(">21<");
  });

  it("自动换行默认开,关闭后正文切 whitespace-pre", () => {
    setGitDiffWrap(false);
    try {
      const nowrap = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
      expect(nowrap).not.toContain("whitespace-pre-wrap");
      expect(nowrap).toContain("whitespace-pre ");
      const splitNowrap = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
      // 双栏 nowrap:左右独立滚动面(2 overflow-auto)+ 中央槽(overflow-hidden)
      expect(splitNowrap.match(/overflow-auto/g)?.length).toBe(2);
      expect(splitNowrap).toContain("git-split-gutter-row");
    } finally {
      setGitDiffWrap(true); // 模块级单例,回置防串其他用例
    }
  });
});
