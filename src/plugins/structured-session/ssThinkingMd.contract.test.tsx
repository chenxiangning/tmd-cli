/** 思考段 md 渲染契约 —— 2026-11-05 用户实证:思考流里的 **加粗** / *斜体* /
 *  `代码` 原样上屏(纯文本 pre-wrap)。钉死两条路径都过真 md 管线:
 * 活轮 LiveTurn 与落定 SsTurnView(折叠组 enterOpen 展开态)。 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { MarkdownBody } from "@plugins/session-viewer/markdownBody";
import { LiveTurn } from "./liveTurn";
import { SsTurnView } from "./ssTurnView";

const THINK = "**决定**把纯文本 *pre-wrap* 换 md 管线,细节在 `ssTurnView`:\n\n- 一条\n- 两条";
const blocks: CliTranscriptBlock[] = [
  { id: "u", role: "user", text: "问" },
  { id: "r", role: "reasoning", text: THINK },
];

describe("思考段 md 渲染", () => {
  it("活轮思考块渲染出 strong/em/code/li,星号反引号不再原样上屏", () => {
    const html = renderToStaticMarkup(
      createElement(LiveTurn, {
        blocks,
        live: true,
        Markdown: MarkdownBody,
        thinkingLabel: "思考中…",
        liveSurface: "thinking",
      }),
    );
    expect(html).toContain("<strong>决定</strong>");
    expect(html).toContain("<em>pre-wrap</em>");
    expect(html).toContain("<code>ssTurnView</code>");
    expect(html).toContain("<li>一条</li>");
  });

  it("落定折叠组展开态同走 md 管线(settleKey 换装帧)", () => {
    const html = renderToStaticMarkup(
      createElement(SsTurnView, { blocks, Markdown: MarkdownBody, settleKey: "u" }),
    );
    expect(html).toContain("<strong>决定</strong>");
    expect(html).toContain("<li>两条</li>");
  });
});
