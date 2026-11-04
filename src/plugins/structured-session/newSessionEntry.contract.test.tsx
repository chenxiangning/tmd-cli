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
}));

vi.mock("@kernel/host", () => ({
  useHost: () => undefined,
  host: {
    getCliProfiles: () => h.profiles,
    getCliProfile: (id: string) => h.profiles.find((p) => p.id === id),
  },
}));
vi.mock("@kernel/tabs", () => ({ getTabs: () => [], openTab: h.openTab }));
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
    expect(html).not.toContain("RPC 会话");
  });

  it("点击行打开独立 structured tab(id 带 structured: 前缀,不共享 PTY 身份)", () => {
    h.profiles = [{ id: "omp", name: "OMP", structuredRpc: true }];
    const html = renderToStaticMarkup(createElement(NewSessionEntry));
    expect(html).toContain("wsmenu-item");
    /* 渲染面不含 onClick;打开语义由 tabs.openStructuredSessionTab 契约守护
       (identityG02/tabs.test),此处只钉入口存在性与能力门。 */
  });
});
