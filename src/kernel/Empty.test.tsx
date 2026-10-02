/**
 * Empty 形制契约(node renderToStaticMarkup):
 * - 骨架:列居中 gap 8px,内距 24px/12px(py-6 px-3);
 * - icon 层:1.25rem(h-5 w-5)fg-faint 容器包调用方 svg;
 * - 文案:text-xs fg-faint 的 span,一句话;
 * - action:至多一枚次级钮(边框 + hover bg),不给主按钮形;
 * - icon/action 缺省时对应层不渲染。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Folder } from "@phosphor-icons/react";

import { Empty } from "./Empty";

describe("Empty", () => {
  it("全要素:icon 层 + 文案 span + action 次级钮", () => {
    const html = renderToStaticMarkup(
      createElement(Empty, {
        icon: createElement(Folder),
        children: "暂无文件",
        action: { label: "新建文件", onClick: () => {} },
      }),
    );
    expect(html).toContain("flex flex-col items-center gap-2 px-3 py-6");
    expect(html).toMatch(
      /<span class="flex h-5 w-5 items-center justify-center text-\(--tmd-fg-faint\) \[&amp;_svg\]:size-full"><svg/,
    );
    expect(html).toMatch(/<span class="text-xs text-\(--tmd-fg-faint\)">暂无文件<\/span>/);
    expect(html).toMatch(/<button[^>]*type="button"/);
    expect(html).toContain("rounded border border-(--tmd-border) px-3 py-1 text-xs");
    expect(html).toContain("hover:bg-(--tmd-bg-hover)");
    expect(html).toContain(">新建文件</button>");
  });

  it("缺省形制:无 icon 不出图标层,无 action 不出按钮", () => {
    const html = renderToStaticMarkup(
      createElement(Empty, { children: "空空如也" }),
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<button");
    expect(html).toContain("空空如也");
  });
});
