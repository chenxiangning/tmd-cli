/**
 * 0.3.9 七候选入口契约 —— 入口消失 = 功能不可达(消费者可见回归):
 * ① worktree 菜单项随 spawnWorktreeFor 出没;② Memory 面板 Wiki 开关钮;
 * ③ diff 批注面板非空组渲染与回传钮可用性。
 * 手法同 WorkspaceAddDialog.test(portal 平铺内联,node 环境无 document;
 * useSyncExternalStore 消费端以桩 store 只验渲染面,store 语义另有专门测试)。
 */
import { renderToStaticMarkup } from "react-dom/server";
import type * as ReactDOM from "react-dom";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof ReactDOM>();
  return { ...actual, createPortal: (node: React.ReactNode) => node };
});
vi.mock("@kernel/i18n", () => ({
  t: (k: string, params?: Record<string, unknown>) =>
    params
      ? Object.entries(params).reduce((acc, [key, v]) => acc.replaceAll(`{${key}}`, String(v)), k)
      : k,
  registerMessages: () => undefined,
}));
vi.stubGlobal("document", { body: {} });
vi.mock("@kernel/host", () => ({
  host: { events: { on: () => () => undefined }, getSessions: () => [] },
}));
vi.mock("@kernel/menuClamp", () => ({
  clampToViewport: (x: number, y: number) => ({ x, y }),
  clampMenuPosition: (x: number, y: number) => ({ x, y }),
}));
/* useSyncExternalStore server 渲染需 getServerSnapshot:store 语义已有专门测试,
   此处桩固定一组数据只验渲染面。 */
vi.mock("../git/diffNotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git/diffNotes")>();
  const notes = [
    { id: "n1", file: "src/a.ts", lineHash: "abc123", lineNo: 10, text: "这里超时和 PTY 要一致", excerpt: "const timeout = 5_000;", ts: 1, sent: false },
  ];
  return {
    ...actual,
    add: () => undefined,
    setNoteStorageForTest: () => undefined,
    useDiffNotesStore: () => ({ order: ["s-audit"], groups: { "s-audit": notes } }),
  };
});
vi.mock("@kernel/useFocusTrap", () => ({ useFocusTrap: () => ({ current: null }) }));
vi.mock("@kernel/DialogShell", () => ({ useEscClose: () => undefined }));
vi.mock("@kernel/workspace", () => ({
  useWorkspaces: () => ({ list: [{ id: "ws1", name: "tmd-cli", root: "/tmp/ws" }], activeId: "ws1" }),
}));

import { SessionContextMenu } from "./SessionContextMenu";
import { MemoryPanelFooter } from "../memory-coordinator/panel/MemoryPanelParts";
import { DiffNotesPanel } from "../git/views/DiffNotesPanel";
import { add, setNoteStorageForTest } from "../git/diffNotes";

describe("入口闭环审计", () => {
  it("① 会话右键菜单:传 spawnWorktreeFor 时显「在新 worktree 中起会话」;不传时不显", () => {
    const base = {
      position: { x: 60, y: 60 },
      canRename: true,
      pinScope: null,
      onCopyId: () => undefined,
      onRename: () => undefined,
      onPinScope: () => undefined,
      onDelete: () => undefined,
      onClose: () => undefined,
    };
    const withWt = renderToStaticMarkup(
      createElement(SessionContextMenu, {
        ...base,
        spawnWorktreeFor: { repoCwd: "/tmp/ws", workspaceId: "ws1", profileId: "claude", title: "审计" },
      }),
    );
    expect(withWt).toContain("在新 worktree 中起会话");
    const withoutWt = renderToStaticMarkup(createElement(SessionContextMenu, { ...base }));
    expect(withoutWt).not.toContain("在新 worktree 中起会话");
  });

  it("② Memory 面板底部:显「Wiki」开关钮", () => {
    const html = renderToStaticMarkup(
      createElement(MemoryPanelFooter, {
        consoleOpen: false,
        wikiOpen: false,
        diag: [],
        diagRunning: false,
        onDiag: () => undefined,
      }),
    );
    expect(html).toContain("Wiki");
  });

  it("③ diff 批注:非空组显条目且回传钮可用", () => {
    const html = renderToStaticMarkup(
      createElement(DiffNotesPanel, { sessionKey: "s-audit" }),
    );
    expect(html).toContain("本回合批注");
    expect(html).toContain("PTY");
    expect(html).toContain("回传给 agent(1 条)");
  });
});
