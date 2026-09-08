/**
 * PatchLines 渲染契约(node 环境 renderToStaticMarkup,只验呈现面):
 * - unified:旧/新双行号槽,add 仅新号、del 仅旧号、ctx 双号;
 * - split:左格旧行号、右格新行号(防右栏无号回归),del 余量右格斜纹占位;
 * - hunk/meta 行通栏不带行号。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PatchLines } from "./PatchLines";

/* ctx old10/new20 + del old11 + add new21 + add new22(右余量一行) */
const PATCH = "@@ -10,1 +20,2 @@\n ctx\n-del\n+addA\n+addB\n";

describe("PatchLines", () => {
  it("unified:双行号槽各归其位", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "unified" }));
    // ctx 双号;del 旧号槽 11;add 新号槽 21/22
    for (const n of [10, 20, 11, 21, 22]) expect(html).toContain(`>${n}<`);
    expect(html).toContain("@@ -10,1 +20,2 @@"); // hunk 头通栏
  });

  it("split:左旧右新行号,del 余量右格斜纹空侧", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH, mode: "split" }));
    // 右格新行号 20/21/22 必须出现(回归:右栏曾恒空);左格旧行号 10/11
    for (const n of [10, 11, 20, 21, 22]) expect(html).toContain(`>${n}<`);
    // 纯 add 余量 → 左格斜纹占位一格
    expect(html.match(/diff-split-empty/g)?.length).toBe(1);
    // hunk 头通栏呈现
    expect(html).toContain("@@ -10,1 +20,2 @@");
  });

  it("默认 mode = unified", () => {
    const html = renderToStaticMarkup(createElement(PatchLines, { text: PATCH }));
    expect(html).not.toContain("diff-split-empty");
    expect(html).toContain(">21<");
  });
});
