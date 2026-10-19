/**
 * 关窗闸契约测试(node 环境,renderToStaticMarkup):
 * - planQuit:脏空/已勾「不再问」= 不拦原生关;有脏未勾 = 聚合问;
 * - QuitDialog:聚合列表逐条渲染(标题+kind),放弃并退出(danger 主钮)/
 *   取消/本次不再问控件齐备。
 * 交互回路(勾选/点击)依赖浏览器事件,由 DialogShell 骨架与真机目检覆盖。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/* node 环境无 document:portal 平铺为内联渲染(DialogConfirm.test 同手法),
 * Esc 订阅的 window 事件也垫空 —— 只验结构,不验挂载点与交互回路。 */
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.stubGlobal("document", { body: {} });
vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });

import { planQuit } from "./quitGuardPlan";
import { QuitDialog } from "./quitGuard";

describe("planQuit", () => {
  it("脏空:不拦(原生关自走)", () => {
    expect(planQuit(0, false)).toBe("noop");
  });

  it("有脏未勾不再问:拦下聚合问", () => {
    expect(planQuit(2, false)).toBe("ask");
  });

  it("勾了本次不再问:等同脏空(镜像 flush 由编排先行,不在此判)", () => {
    expect(planQuit(3, true)).toBe("noop");
  });
});

describe("QuitDialog", () => {
  const entries = [
    { id: "file:/ws/src/config.toml", title: "src/config.toml", kind: "file" },
    { id: "session:1", title: "10-19 便签", kind: "daily-article" },
  ];
  const html = renderToStaticMarkup(
    createElement(QuitDialog, { entries, onConfirm: () => {}, onCancel: () => {} }),
  );

  it("聚合列表逐条渲染,标题走 t()(i18n 已 mock 为恒等,断言键面)", () => {
    expect(html).toContain("有 {n} 个未保存草稿");
    expect(html).toContain("src/config.toml");
    expect(html).toContain("10-19 便签");
    expect(html).toContain("file");
    expect(html).toContain("daily-article");
  });

  it("放弃并退出(danger 主钮)/取消/本次不再问三控件齐备", () => {
    expect(html).toContain("放弃并退出");
    expect(html).toContain("取消");
    expect(html).toContain("本次不再问");
    expect(html).toContain('type="checkbox"');
  });
});
