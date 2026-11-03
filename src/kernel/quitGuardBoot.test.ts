/**
 * 关窗/重启共用退出协调契约(node 环境,mock 命令式弹层):
 * 程序性重启必须先 flush、强关 tab 再动作;脏稿取消零关闭副作用;
 * 原生关窗脏空仍不 prevent,确认后才销毁窗口。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  renderMock: vi.fn(),
  unmountMock: vi.fn(),
  hostMock: { remove: vi.fn() },
  getTabsMock: vi.fn(),
  flushMock: vi.fn(),
  closeAllMock: vi.fn(),
  destroyMock: vi.fn(),
  closeRequestMock: vi.fn(),
}));
const { renderMock, hostMock, getTabsMock, flushMock, closeAllMock, destroyMock, closeRequestMock } = mocks;

vi.mock("react-dom/client", () => ({
  createRoot: vi.fn(() => ({ render: mocks.renderMock, unmount: mocks.unmountMock })),
}));
vi.mock("./tabs", () => ({ getTabs: mocks.getTabsMock }));
vi.mock("./draftMirror", () => ({ draftMirrorFlushAll: mocks.flushMock }));
vi.mock("./tabClose", () => ({ requestCloseAllTabs: mocks.closeAllMock }));
vi.mock("./ipc", () => ({
  onWindowCloseRequest: mocks.closeRequestMock,
  windowDestroy: mocks.destroyMock,
}));
vi.mock("./quitGuard", () => ({ QuitDialog: () => null }));

vi.stubGlobal("document", {
  createElement: vi.fn(() => hostMock),
  body: { appendChild: vi.fn() },
});

import { bootQuitGuard, confirmAppExit } from "./quitGuardBoot";

type QuitDialogProps = {
  entries: readonly { id: string; title: string; kind: string }[];
  onConfirm: (dontAsk: boolean) => void;
  onCancel: () => void;
};

function renderedDialog(): ReactElement<QuitDialogProps> {
  expect(renderMock).toHaveBeenCalledOnce();
  return renderMock.mock.calls[0][0] as ReactElement<QuitDialogProps>;
}

const dirtyTab = { id: "file:/a", title: "a.txt", kind: "file", dirty: true };

beforeEach(() => {
  vi.clearAllMocks();
  getTabsMock.mockReturnValue([]);
  closeAllMock.mockResolvedValue(undefined);
});

describe("confirmAppExit 重启路径", () => {
  it("无脏稿也先 flush、走 quit 强关协调,结算后才重启", async () => {
    const order: string[] = [];
    flushMock.mockImplementation(() => order.push("flush"));
    closeAllMock.mockImplementation(() => {
      order.push("close");
      return Promise.resolve();
    });
    const restart = vi.fn(() => order.push("restart"));

    confirmAppExit(restart);
    expect(closeAllMock).toHaveBeenCalledWith({ quit: true });
    expect(restart).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(order).toEqual(["flush", "close", "restart"]);
  });

  it("脏稿取消:不强制关 tab、不重启,仅保留先行镜像 flush", () => {
    getTabsMock.mockReturnValue([dirtyTab, { ...dirtyTab, id: "clean", dirty: false }]);
    const restart = vi.fn();

    confirmAppExit(restart);
    const dialog = renderedDialog();
    expect(dialog.props.entries).toEqual([
      { id: dirtyTab.id, title: dirtyTab.title, kind: dirtyTab.kind },
    ]);
    dialog.props.onCancel();

    expect(flushMock).toHaveBeenCalledOnce();
    expect(closeAllMock).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("脏稿确认前零关闭副作用;确认后才强关并重启", async () => {
    getTabsMock.mockReturnValue([dirtyTab]);
    const restart = vi.fn();

    confirmAppExit(restart);
    expect(closeAllMock).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();

    renderedDialog().props.onConfirm(false);
    expect(closeAllMock).toHaveBeenCalledWith({ quit: true });
    expect(restart).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(restart).toHaveBeenCalledOnce();
  });
});

describe("confirmAppExit 原生关窗兼容", () => {
  it("脏空不拦截原生关;脏稿确认后仍按原链销毁窗口", async () => {
    bootQuitGuard();
    const onClose = closeRequestMock.mock.calls[0][0] as (prevent: () => void) => void;
    const prevent = vi.fn();

    onClose(prevent);
    expect(prevent).not.toHaveBeenCalled();
    expect(closeAllMock).not.toHaveBeenCalled();
    expect(destroyMock).not.toHaveBeenCalled();

    getTabsMock.mockReturnValue([dirtyTab]);
    onClose(prevent);
    expect(prevent).toHaveBeenCalledOnce();
    renderedDialog().props.onConfirm(false);
    await Promise.resolve();
    expect(closeAllMock).toHaveBeenCalledWith({ quit: true });
    expect(destroyMock).toHaveBeenCalledOnce();
  });
});
