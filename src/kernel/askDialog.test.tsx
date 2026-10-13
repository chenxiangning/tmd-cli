/**
 * askDialog 结算契约(node 环境,mock react-dom/client 与 document):
 * - 确认 resolve true,取消/Esc/点背板(onClose)resolve false;
 * - 首答即决:onConfirm 后紧跟的 onClose 不改写结果,unmount 恰一次;
 * - 卸载延后一拍:settle 同步拍不 unmount(不打断事件派发),下一拍清宿主;
 * - 无 document(SSR/node 直调)按取消结算,不抛错。
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

const renderMock = vi.fn();
const unmountMock = vi.fn();
const hostMock = { remove: vi.fn() };

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: renderMock, unmount: unmountMock })),
}));

vi.stubGlobal("document", {
  createElement: vi.fn(() => hostMock),
  body: { appendChild: vi.fn() },
});

import { askDialog } from "./askDialog";

/** 取 askDialog 渲染进临时 root 的 ConfirmDialog 元素(读它的回调 props)。 */
function renderedElement(): ReactElement<{
  onConfirm: () => void;
  onClose: () => void;
}> {
  expect(renderMock).toHaveBeenCalledOnce();
  return renderMock.mock.calls[0][0] as ReactElement<{
    onConfirm: () => void;
    onClose: () => void;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("askDialog", () => {
  it("确认 → true,卸载延后一拍且宿主移除", async () => {
    const p = askDialog({ title: "未保存的修改", message: "未保存的修改将丢失" });
    const el = renderedElement();
    el.props.onConfirm();
    await expect(p).resolves.toBe(true);
    expect(unmountMock).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(unmountMock).toHaveBeenCalledOnce();
    expect(hostMock.remove).toHaveBeenCalledOnce();
  });

  it("取消(onClose)→ false,草稿语义由调用方落", async () => {
    const p = askDialog({ title: "t", message: "m", confirmLabel: "丢弃", danger: true });
    renderedElement().props.onClose();
    await expect(p).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(unmountMock).toHaveBeenCalledOnce();
  });

  it("首答即决:确认后残留的 onClose 不改写结果,unmount 仍恰一次", async () => {
    const p = askDialog({ title: "t", message: "m" });
    const el = renderedElement();
    el.props.onConfirm();
    el.props.onClose();
    await expect(p).resolves.toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(unmountMock).toHaveBeenCalledOnce();
    expect(hostMock.remove).toHaveBeenCalledOnce();
  });

  it("无 document 环境 → 按取消结算不抛错", async () => {
    const g = globalThis as { document?: unknown };
    const saved = g.document;
    delete g.document;
    try {
      await expect(askDialog({ title: "t", message: "m" })).resolves.toBe(false);
    } finally {
      g.document = saved;
    }
  });
});
