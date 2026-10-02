/**
 * DialogShell 骨架契约(node renderToStaticMarkup,mock 手法同 DialogConfirm.test):
 * - dialog 卡片带统一入场动画(内联 animation 引全局 tmdDialogIn,
 *   时长/缓动走 --tmd-dur-2/--tmd-ease-move token);
 * - DialogActions submitting 态:主钮内 Spinner(role=status)+「加载中…」
 *   并排,取消/主钮均 disabled;
 * - 非 submitting 态:主钮只出 confirmLabel,无 Spinner。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/* node 环境无 document:portal 平铺为内联渲染(只验结构,不验挂载点) */
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));

vi.stubGlobal("document", { body: {} });

import { DialogActions, DialogShell } from "./DialogShell";

describe("DialogShell 入场形制", () => {
  it("dialog 卡片带 tmdDialogIn 入场动画(dur-2 + ease-move)", () => {
    const html = renderToStaticMarkup(
      createElement(DialogShell, {
        title: "推送分支",
        icon: null,
        onClose: () => {},
        children: null,
        footer: null,
      }),
    );
    expect(html).toContain("<dialog");
    expect(html).toContain(
      "animation:tmdDialogIn var(--tmd-dur-2) var(--tmd-ease-move)",
    );
  });
});

describe("DialogActions submitting 态", () => {
  const props = {
    confirmLabel: "推送",
    onConfirm: () => {},
    onCancel: () => {},
  };

  it("submitting:Spinner + 「加载中…」并排,双钮禁用", () => {
    const html = renderToStaticMarkup(
      createElement(DialogActions, { ...props, submitting: true }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("animation:tmdSpin 1s linear infinite");
    expect(html).toContain("加载中…");
    expect(html).not.toContain(">推送<");
    expect(html.match(/disabled(?:="")?(?=[>\s/])/g)).toHaveLength(2);
  });

  it("非 submitting:主钮只出 confirmLabel,无 Spinner", () => {
    const html = renderToStaticMarkup(createElement(DialogActions, props));
    expect(html).toContain(">推送</button>");
    expect(html).not.toContain('role="status"');
    expect(html).not.toMatch(/disabled(?:="")?(?=[>\s/])/);
  });
});
