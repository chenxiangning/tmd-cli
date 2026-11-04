/**
 * D-03 统一壳 · sessions 域契约(node 环境 renderToStaticMarkup):
 * - session-search 启用且有活动工作区:渲染本体(SessionSearchBody,open=true,
 *   onRequestClose=closeSearchOverlay);
 * - session-search 禁用:不渲染(不偷偷启用其索引);
 * - 无活动工作区:不渲染(命令层已有同款闸,壳内防御)。
 * 命令/浮层开合矩阵见 session-search 侧契约测试。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { disabled, bodyProps, wsState } = vi.hoisted(() => ({
  disabled: [] as string[],
  bodyProps: [] as unknown[],
  wsState: { ws: { id: "ws1", root: "/a" } as { id: string; root: string } | null },
}));

vi.mock("@kernel/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kernel/settings")>();
  return {
    ...actual,
    getSettingsState: () => ({ settings: { disabledPlugins: disabled } }),
    useSettingsState: () => ({ settings: { disabledPlugins: disabled } }),
  };
});
vi.mock("@kernel/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kernel/workspace")>();
  return { ...actual, getActiveWorkspace: () => wsState.ws };
});
vi.mock("@plugins/session-search/SearchBody", () => ({
  SessionSearchBody: (props: unknown) => {
    bodyProps.push(props);
    return null;
  },
  SessionSearchToast: () => null,
}));

import { SessionsBody } from "./SessionsBody";
import { closeSearchOverlay } from "./overlayStore";

beforeEach(() => {
  disabled.length = 0;
  bodyProps.length = 0;
  wsState.ws = { id: "ws1", root: "/a" };
});

describe("统一壳 sessions 域", () => {
  it("session-search 启用且有工作区:渲染本体并注入壳的关闭回调", () => {
    renderToStaticMarkup(createElement(SessionsBody));
    expect(bodyProps).toHaveLength(1);
    expect(bodyProps[0]).toEqual({ open: true, onRequestClose: closeSearchOverlay });
  });

  it("session-search 禁用:不渲染本体", () => {
    disabled.push("session-search");
    const html = renderToStaticMarkup(createElement(SessionsBody));
    expect(html).toBe("");
    expect(bodyProps).toHaveLength(0);
  });

  it("无活动工作区:不渲染本体", () => {
    wsState.ws = null;
    renderToStaticMarkup(createElement(SessionsBody));
    expect(bodyProps).toHaveLength(0);
  });
});
