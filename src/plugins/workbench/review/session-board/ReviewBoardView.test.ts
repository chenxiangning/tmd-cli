/** ReviewBoardView 静态渲染契约(批次 C-03)——回顾 → 会话活动嵌入壳:
 *  必须复用 BoardTab 本体(同目录,迁移后零跨插件依赖); BoardTab 本体行为
 *  由 boardData/boardRows 测试守护。
 *  node 环境无 jsdom,用 renderToStaticMarkup + mock 断言渲染在场性。 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const boardTabProps = vi.fn();
vi.mock("./BoardTab", () => ({
  BoardTab: (props: unknown) => {
    boardTabProps(props);
    return null;
  },
}));

import { ReviewBoardView } from "./ReviewBoardView";

describe("ReviewBoardView 嵌入壳", () => {
  it("渲染 BoardTab 且不注入任何形态覆盖", () => {
    boardTabProps.mockClear();
    renderToStaticMarkup(createElement(ReviewBoardView));
    expect(boardTabProps).toHaveBeenCalledTimes(1);
    expect(boardTabProps).toHaveBeenCalledWith({});
  });
});
