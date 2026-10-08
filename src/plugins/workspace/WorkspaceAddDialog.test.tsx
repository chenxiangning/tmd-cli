/**
 * 添加工作区浮层(来源卡两步)渲染契约 —— node renderToStaticMarkup,
 * mock 手法同 DialogShell.test(portal 平铺内联渲染):
 * - 入口步 = 本地目录卡(整卡动作)+ 各来源注册卡(label/desc 透传);
 * - 段控 wsl-mode-seg 永不再出现(0.3.x 裸类黏连 bug 回归锚);
 * - 无来源注册 = 只剩本地卡,不渲染来源壳。
 * 两步切换/本地卡直达 picker 的交互走桩目检(1421),不在此钉。
 */

import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactDOM from "react-dom";
import type * as WorkspaceOrigins from "@kernel/workspaceOrigins";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

/* node 环境无 document:portal 平铺为内联渲染(只验结构,不验挂载点) */
vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOM>();
  return { ...actual, createPortal: (node: ReactNode) => node };
});
vi.mock("@kernel/i18n", () => ({ t: (k: string) => k }));
vi.mock("@kernel/ipc", () => ({ pickDirectory: vi.fn() }));
vi.mock("@kernel/workspace", () => ({ addWorkspace: vi.fn() }));
/* useSyncExternalStore 无 server 快照:注册表订阅端以可变列表桩替代
   (注册表本身另有 store 语义测试,此处只验消费面)。 */
const originsStub = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("@kernel/workspaceOrigins", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkspaceOrigins>();
  return { ...actual, useWorkspaceOrigins: () => originsStub.list };
});

vi.stubGlobal("document", { body: {} });

import { WorkspaceAddDialog } from "./WorkspaceAddDialog";

function render(): string {
  return renderToStaticMarkup(
    createElement(WorkspaceAddDialog, { position: { x: 10, y: 10 }, onClose: () => {} }),
  );
}

describe("添加工作区浮层 · 来源卡入口步", () => {
  it("本地卡 + 来源卡(label/desc 透传),无段控", () => {
    originsStub.list = [
      {
        id: "t-wsl",
        label: "WSL",
        matches: () => false,
        addTab: {
          label: "WSL 发行版",
          desc: "经 \\\\wsl.localhost 或 SSH 远程宿主添加",
          component: () => createElement("div", null, "wsl-tab-body"),
        },
      },
    ];
    const html = render();
    expect(html).toContain("添加工作区");
    expect(html).toContain("本地目录");
    expect(html).toContain("选择一个本机目录作为工作区根。");
    expect(html).toContain("WSL 发行版");
    expect(html).toContain("经 \\\\wsl.localhost 或 SSH 远程宿主添加");
    /* 段控裸类缺陷回归锚:入口步不允许再出现无样式段控 */
    expect(html).not.toContain("wsl-mode-seg");
  });

  it("无来源注册 = 只剩本地卡,无来源壳", () => {
    originsStub.list = [];
    const html = render();
    expect(html).toContain("本地目录");
    expect(html).not.toContain("wsl-mode-seg");
    expect(html.match(/wsadd-card"/g)?.length).toBe(1);
  });
});
