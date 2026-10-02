/**
 * ConfirmDialog / InputDialog 渲染契约(node 环境 renderToStaticMarkup):
 * - ConfirmDialog:danger 红底主钮 + 默认确认词「确认」,取消钮在场;
 * - InputDialog:form/submit 钮型齐备,validate 错误出 role=alert 行内红字,
 *   空值时 submit 置灰(disabled 属性在场)。
 * 交互回路(Enter/Esc)依赖浏览器事件,由 DialogShell 既有骨架与真机目检覆盖。
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

/* createPortal 第二实参 document.body 在 node 下求值即炸:垫最小 document
 * (portal 本身已被平铺 mock,容器对象不会被真正触碰)。 */
vi.stubGlobal("document", { body: {} });

import { ConfirmDialog, InputDialog } from "./DialogConfirm";

describe("ConfirmDialog", () => {
  it("默认形制:确认词「确认」+ 取消钮,非 danger 走 accent 主钮", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        title: "删除主机",
        message: "将删除该主机的全部记录",
        onConfirm: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("确认");
    expect(html).toContain("取消");
    expect(html).toContain("bg-(--tmd-accent)");
    expect(html).not.toContain("bg-(--tmd-err)");
  });

  it("danger 形制:主钮红底,confirmLabel 动词型可覆写", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        title: "断开会话",
        message: "正在运行的命令将被终止",
        confirmLabel: "断开",
        danger: true,
        onConfirm: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("bg-(--tmd-err)");
    expect(html).toContain("断开");
  });
});

describe("InputDialog", () => {
  it("空初值时提交钮置灰,form 包裹保 Enter 提交路径", () => {
    const html = renderToStaticMarkup(
      createElement(InputDialog, {
        title: "重命名",
        label: "新名称",
        onSubmit: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("<form");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]* disabled(?:=|[>\s/])/);
  });

  it("初值非空且校验通过时可提交;校验失败出 role=alert", () => {
    const ok = renderToStaticMarkup(
      createElement(InputDialog, {
        title: "重命名",
        label: "新名称",
        initial: "host-a",
        onSubmit: () => {},
        onClose: () => {},
      }),
    );
    expect(ok).not.toMatch(/type="submit"[^>]* disabled(?:=|[>\s/])/);

    const bad = renderToStaticMarkup(
      createElement(InputDialog, {
        title: "重命名",
        label: "新名称",
        initial: "bad!",
        validate: (v) => (v.includes("!") ? "名称不可包含 !" : undefined),
        onSubmit: () => {},
        onClose: () => {},
      }),
    );
    expect(bad).toContain('role="alert"');
    expect(bad).toContain("名称不可包含 !");
    expect(bad).toMatch(/type="submit"[^>]* disabled(?:=|[>\s/])/);
  });
});
