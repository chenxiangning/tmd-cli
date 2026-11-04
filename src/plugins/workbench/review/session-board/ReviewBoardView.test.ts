/** ReviewBoardView 静态渲染契约(批次 C-03)——回顾 → 会话活动嵌入壳:
 *  必须复用 session-board BoardTab 且以 embedded 形态渲染(不收板钮、
 *  键盘链不查覆盖层开关); BoardTab 本体行为由其原处测试守护。
 *  node 环境无 jsdom,用 renderToStaticMarkup + mock 断言 props 透传。 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const boardTabProps = vi.fn();
vi.mock("@plugins/session-board/BoardTab", () => ({
  BoardTab: (props: unknown) => {
    boardTabProps(props);
    return null;
  },
}));

import { ReviewBoardView } from "./ReviewBoardView";

describe("ReviewBoardView 嵌入壳", () => {
  it("以 embedded 形态渲染 BoardTab", () => {
    boardTabProps.mockClear();
    renderToStaticMarkup(createElement(ReviewBoardView));
    expect(boardTabProps).toHaveBeenCalledTimes(1);
    expect(boardTabProps).toHaveBeenCalledWith({ embedded: true });
  });
});
