/**
 * StartFailureNotices 渲染契约测试(node 环境 renderToStaticMarkup):
 * - 标题 = profile 展示名 + 「会话启动失败」;
 * - reason 摘录进 <pre>;关闭按钮带 aria-label;
 * - 无通知时渲染 null(不占位)。
 * 订阅/计时在 StartFailureToast(useEffect 不入静态渲染),此处只验呈现面。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

/* 组件渲染期读 host.getCliProfile 解析展示名;node 环境注入假名册。 */
vi.mock("@kernel/host", () => ({
  host: {
    getCliProfile: (id: string) => (id === "omp" ? { id, name: "OMP" } : undefined),
  },
}));

import { StartFailureNotices } from "./StartFailureToast";

const NOTICE = {
  id: 1,
  sessionId: "pty-1",
  profileId: "omp",
  reason: "ConfigurationError: built-in API names are reserved.",
};

describe("StartFailureNotices", () => {
  it("渲染引擎名标题 + 报错摘录 + 关闭按钮", () => {
    const html = renderToStaticMarkup(
      createElement(StartFailureNotices, { notices: [NOTICE], onClose: () => undefined }),
    );
    expect(html).toContain("OMP 会话启动失败");
    expect(html).toContain("ConfigurationError: built-in API names are reserved.");
    expect(html).toContain('aria-label="关闭启动失败通知"');
    expect(html).toContain('role="alert"');
  });

  it("profileId 未注册/为 null:标题退化为通用 CLI", () => {
    const html = renderToStaticMarkup(
      createElement(StartFailureNotices, {
        notices: [{ ...NOTICE, profileId: null }],
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("CLI 会话启动失败");
  });

  it("无通知:渲染 null", () => {
    const html = renderToStaticMarkup(
      createElement(StartFailureNotices, { notices: [], onClose: () => undefined }),
    );
    expect(html).toBe("");
  });
});
