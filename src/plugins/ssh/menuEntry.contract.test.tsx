/**
 * MenuEntry 契约 —— 新建会话菜单「SSH 连接」行:点击打开主机选择器并回调
 * onClose 关闭宿主菜单。挂点行此前拿不到菜单宿主 onClose,点击后弹层滞留
 * (2026-11-05 与 structured-session NewSessionEntry 同缺陷类,Mounts props
 * 透传一并修复,此处钉回归)。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ openPicker: vi.fn() }));
vi.mock("./state", () => ({ openHostPicker: h.openPicker }));
vi.mock("@kernel/i18n", () => ({ t: (s: string) => s }));

import { MenuEntry } from "./MenuEntry";

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
  h.openPicker.mockReset();
});

describe("MenuEntry 点击语义", () => {
  it("点击打开主机选择器并回调 onClose(宿主菜单同步关闭)", () => {
    const onClose = vi.fn();
    findButton(MenuEntry({ onClose })).onClick?.();
    expect(h.openPicker).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
