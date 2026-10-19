/**
 * AnimProjectRow 渲染契约测试(node 环境 renderToStaticMarkup):
 * - canOpen=false(平台无打开语义:非 mac 非 win)不渲染「打开」钮,「AI 会话」钮保留;
 * - canOpen=true(mac app / windows reveal 两态)两钮齐出;无效项目(name=null)显示警示「无效项目」。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AnimProjectRow } from "./AnimProjectRow";

type RowProps = Parameters<typeof AnimProjectRow>[0];

function renderRow(overrides?: Partial<RowProps>): string {
  return renderToStaticMarkup(
    createElement(AnimProjectRow, {
      path: "/p/a.json",
      file: "a.json",
      name: "演示",
      scenes: 3,
      starting: false,
      canOpen: true,
      onOpen: () => {},
      onAi: () => {},
      ...overrides,
    }),
  );
}

describe("AnimProjectRow 平台闸", () => {
  it("canOpen=true:打开与 AI 会话两钮齐出", () => {
    const html = renderRow();
    expect(html).toContain(">打开</button>");
    expect(html).toContain("AI 会话");
  });

  it("canOpen=false(非 macOS):不渲染「打开」钮,AI 会话保留", () => {
    const html = renderRow({ canOpen: false });
    /* 文件名钮 title 含「在编辑器中打开」,须精确匹配钮文本。 */
    expect(html).not.toContain(">打开</button>");
    expect(html).toContain("AI 会话");
  });

  it("name=null:无效项目警示态,场景徽标不渲染", () => {
    const html = renderRow({ name: null, scenes: null });
    expect(html).toContain("无效项目");
    expect(html).not.toContain("幕");
  });
});
