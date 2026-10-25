/**
 * ⌘F 日志全文搜索面渲染契约(react-dom/server 静态渲染):
 * - 按钮态:搜索中显「搜索日志中…」,常态显「搜完整日志」;
 * - 命中列表:表头计数 + 截断标注,命中行 = 行预览文本,点击经 onPick 上抛偏移。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@kernel/i18n", () => ({
  t: (k: string, p?: Record<string, string>) =>
    p ? Object.entries(p).reduce((s, [name, v]) => s.replace(`{${name}}`, v), k) : k,
}));

import { TerminalLogHits, TerminalLogSearchButton } from "./terminalSearchLog";

describe("TerminalLogSearchButton", () => {
  it("常态与搜索中两态文案", () => {
    const idle = renderToStaticMarkup(createElement(TerminalLogSearchButton, { searching: false, onClick: () => undefined }));
    expect(idle).toContain("搜完整日志");
    const busy = renderToStaticMarkup(createElement(TerminalLogSearchButton, { searching: true, onClick: () => undefined }));
    expect(busy).toContain("搜索日志中…");
  });
});

describe("TerminalLogHits", () => {
  const result = {
    hits: [
      { byteOffset: 0, line: "ERR boom" },
      { byteOffset: 128, line: "ERR again" },
    ],
    totalHits: 3,
    truncated: false,
  };

  it("表头计数 + 命中行预览 + 截断标注", () => {
    const html = renderToStaticMarkup(
      createElement(TerminalLogHits, { result, jumping: false, onPick: () => undefined }),
    );
    expect(html).toContain("日志命中 3 处");
    expect(html).toContain("ERR boom");
    expect(html).toContain("ERR again");
    expect(html).not.toContain("仅列前");

    const cut = renderToStaticMarkup(
      createElement(TerminalLogHits, { result: { ...result, truncated: true }, jumping: true, onPick: () => undefined }),
    );
    expect(cut).toContain("仅列前 2 行");
    expect(cut).toContain("定位中…");
  });
});
