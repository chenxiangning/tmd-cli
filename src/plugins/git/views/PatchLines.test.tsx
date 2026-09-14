/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - unified:自绘经典红绿,旧/新双行号槽;
 * - split:自绘三列(左右内容 | 中央行号槽),对位/占位由 buildSplitRows,
 *   这里验 色带与词级标注、改动块边框(槽括号框 + 内容列首尾横线)、
 *   nowrap 态左右独立横向滚动面。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PatchLines } from "./PatchLines";
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

  it("split:色带/行号/词级标注按配对语义", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 全部行号可达:ctx 10|20、mod 对 11|21、add 余量 ·|22
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // 修改对(左红右绿同行):band-del ×1 + band-add ×2(mod 右 + add 右)
    expect(html.match(/git-split-band-del/g)?.length).toBe(1);
    expect(html.match(/git-split-band-add/g)?.length).toBe(2);
    // mod 对词级下划线标注
    expect(html).toContain("git-split-word-del");
    expect(html).toContain("git-split-word-ins");
    // 改动块标记:缺侧占位色块 + 旧号 ⤶ 钩 + 空槽 ⬚
    expect(html).toContain("git-split-ph-add");
    expect(html).toContain("git-split-ghook");
    expect(html.match(/git-split-gslot-empty/g)?.length).toBe(1);
  });

  it("split:改动块边框 = 槽列括号框 + 内容列首尾横线", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // mod(first)+ add(last)两行进块框;ctx 不入框
    expect(html.match(/git-split-frame(?!-)/g)?.length).toBe(2);
    // 块首 = mod 行:框顶 + 两列顶横线;块尾 = add 行:框底 + 列底横线
    expect(html).toContain("git-split-frame-top");
    expect(html).toContain("git-split-frame-bot");
    expect(html.match(/git-split-bd-top/g)?.length).toBe(2); // mod 行左右两格
    expect(html.match(/git-split-bd-bot/g)?.length).toBe(2); // add 行左右两格
  });

  it("默认 mode = unified", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
    expect(html).toContain(">21<");
    expect(html).not.toContain("git-split-frame"); // 未走双栏
  });

  it("自动换行关闭:双栏切左右独立横向滚动面", () => {
    const on = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    expect(on.match(/overflow-auto/g)?.length).toBe(1); // 仅外层 pre 一个滚动面
    setGitDiffWrap(false);
    try {
      const off = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
      // halves 态:左右两 overflow-auto 滚动面 + 中央槽 overflow-hidden
      expect(off.match(/overflow-auto/g)?.length).toBe(2);
      expect(off).toContain("overflow-hidden");
      expect(off).toContain("git-split-gutter-row");
      const unifiedNowrap = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
      expect(unifiedNowrap).toContain("whitespace-pre ");
    } finally {
      setGitDiffWrap(true); // 模块级单例,回置防串其他用例
    }
  });
});
