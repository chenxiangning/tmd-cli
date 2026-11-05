/**
 * G-01/G-02 NewSessionEntry 契约 —— 新建菜单「带渲染的会话」入口:
 * 只列声明 structuredRpc 的引擎;无能力引擎渲染 null(菜单无死入口);
 * 行文案 = 引擎名(组头/组说明承担「带渲染」语义);点击打开独立 structured tab。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  profiles: [] as Array<{ id: string; name: string; structuredRpc?: boolean }>,
  openTab: vi.fn(),
  emitEvent: vi.fn(),
}));

vi.mock("@kernel/host", () => ({
  useHost: () => undefined,
  host: {
    getCliProfiles: () => h.profiles,
    getCliProfile: (id: string) => h.profiles.find((p) => p.id === id),
    /* 点击行发 editorMaximizeRequested(打开即沉浸)的消费面。 */
    events: { emit: h.emitEvent },
  },
}));
vi.mock("@kernel/tabs", () => ({
  getTabs: () => [],
  openTab: h.openTab,
  getTab: () => null,
  subscribeEditorTabs: () => () => {},
}));
vi.mock("@kernel/workspace", () => ({
  getActiveWorkspace: () => ({ root: "/repo" }),
  getWorkspaces: () => [{ root: "/repo" }],
}));
vi.mock("@kernel/sessionViewTabs", () => ({
  isSessionViewAvailable: () => true,
  openSessionViewAtText: vi.fn(),
}));
vi.mock("@kernel/i18n", () => ({
  t: (text: string, params?: Record<string, string>) =>
    params ? text.replace("{name}", params.name ?? "") : text,
}));

import { NewSessionEntry } from "./NewSessionEntry";

/* 节点测试环境无 DOM:递归 React 元素树取首个 button,直调其 onClick 验证点击语义。 */
function findButton(node: unknown): { onClick?: () => void } {
  if (!node || typeof node !== "object") return {};
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findButton(child);
      if (hit.onClick) return hit;
    }
    return {};
  }
  const el = node as { type?: unknown; props?: { onClick?: () => void; children?: unknown } };
  if (el.type === "button") return el.props ?? {};
  return findButton(el.props?.children);
}

beforeEach(() => {
  h.profiles = [];
  h.openTab.mockReset();
});

describe("G-01 NewSessionEntry 能力门", () => {
  it("无 structuredRpc 引擎 → 渲染 null(无死入口)", () => {
    h.profiles = [{ id: "claude", name: "claude" }];
    expect(renderToStaticMarkup(createElement(NewSessionEntry))).toBe("");
  });

  it("只列声明 structuredRpc 的引擎,行文案 = 引擎名(「带渲染」语义由菜单组头承担)", () => {
    h.profiles = [
      { id: "omp", name: "OMP", structuredRpc: true },
      { id: "pi", name: "Pi", structuredRpc: true },
      { id: "claude", name: "claude" },
    ];
    const html = renderToStaticMarkup(createElement(NewSessionEntry));
    expect(html).toContain("OMP");
    expect(html).toContain("Pi");
    expect(html).not.toContain("claude");
    expect(html).not.toContain("重开上次会话"); /* 2026-11-05 撤除:续聊入口不再进新建菜单 */
  });

  it("点击行打开独立 structured tab(id 带 structured: 前缀)并回调 onClose 关闭宿主菜单", () => {
    h.profiles = [{ id: "omp", name: "OMP", structuredRpc: true }];
    const onClose = vi.fn();
    const button = findButton(NewSessionEntry({ onClose }));
    button.onClick?.();
    expect(h.openTab).toHaveBeenCalledTimes(1);
    expect(h.openTab.mock.calls[0]?.[0]).toMatchObject({ kind: "structured-session", payload: { profileId: "omp" } });
    expect(onClose).toHaveBeenCalledTimes(1); /* 回归钉:点击后菜单宿主必须关闭(2026-11-05 弹窗不关缺陷) */
    /* 打开即沉浸(2026-11-06):点击同发 editorMaximizeRequested,详情页直接最大化。 */
    expect(h.emitEvent).toHaveBeenCalledWith("kernel.shell.editorMaximizeRequested", null);
  });
});
