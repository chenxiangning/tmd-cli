/**
 * 发送变换与附件桥单测:AI 作画开关注入闸、附件消费/undo 恢复回路。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

let aiEnabled = true;
let capturedTransform: ((text: string, sessionId: string | null) => string) | null = null;
let capturedUndo: (() => void) | null = null;

vi.mock("@kernel/composerExt", () => ({
  registerComposerSendTransform: (fn: (text: string, sessionId: string | null) => string) => {
    capturedTransform = fn;
  },
  registerComposerSendUndo: (fn: () => void) => {
    capturedUndo = fn;
  },
}));
vi.mock("@kernel/host", () => ({
  host: { getActiveSessionId: () => "session-a" },
}));
vi.mock("@kernel/workspace", () => ({
  getActiveWorkspace: () => ({ id: "ws1", name: "demo", root: "/tmp/ws-demo", createdAt: 1 }),
}));
vi.mock("../aiDrawStore", () => ({
  aiDrawPref: () => ({ enabled: aiEnabled }),
}));
vi.mock("../activeDocumentBridge", () => ({
  activeDocumentRef: { current: null },
}));
vi.mock("../utils/contextFormat", () => ({
  formatIntentCanvasThreadContext: (doc: { id: string }) => `CANVAS_CTX(${doc.id})`,
}));

import { registerIntentCanvasSendTransform } from "../sendTransform";
import { cacheAiDrawInboxPath } from "../aiDrawPrompt";
import {
  consumeAttachments,
  restoreAttachments,
  stageAttachment,
  attachmentsSnapshot,
} from "../store";
import type { IntentCanvasDocument } from "../types";

beforeEach(() => {
  aiEnabled = true;
  capturedTransform = null;
  capturedUndo = null;
  vi.resetModules();
});

const doc = {
  version: 1,
  kind: "intent-canvas",
  id: "canvas-1",
  title: "图",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  workspace: { id: "ws1", name: null },
  mode: "architect",
  summary: "",
  links: { projectMapNodeIds: [], filePaths: [], threadIds: [] },
  scene: { elements: [], appState: {}, files: {} },
  aiContext: null,
  semanticGraphs: [],
  aiAnnotations: [],
} as unknown as IntentCanvasDocument;

describe("intentCanvasSendTransform", () => {
  it("inbox 路径未缓存时(未开过画布)不注入作画指令", () => {
    registerIntentCanvasSendTransform();
    expect(capturedTransform!("你好", "session-a")).toBe("你好");
  });

  it("开关开启且缓存命中时注入作画指令段(含 inbox 路径)", () => {
    registerIntentCanvasSendTransform();
    cacheAiDrawInboxPath("/tmp/ws-demo", "/home/t/.tmd-cli/intent-canvas/abc/inbox");
    const out = capturedTransform!("你好", "session-a");
    expect(out).toContain("你好");
    expect(out).toContain("【意图画布 AI 作画】");
    expect(out).toContain("/home/t/.tmd-cli/intent-canvas/abc/inbox");
  });

  it("开关关闭时不注入", async () => {
    aiEnabled = false;
    vi.resetModules();
    const mod = await import("../sendTransform");
    mod.registerIntentCanvasSendTransform();
    expect(capturedTransform!("你好", "session-a")).toBe("你好");
  });

  it("附件随发送注入并消费;undo 恢复同会话 pending", () => {
    registerIntentCanvasSendTransform();
    aiEnabled = false; // 关掉作画指令,聚焦附件断言
    stageAttachment("session-a", doc);
    const out = capturedTransform!("你好", "session-a");
    expect(out).toContain("CANVAS_CTX(canvas-1)");
    expect(attachmentsSnapshot().pending["session-a"]).toHaveLength(0);
    capturedUndo!();
    expect(attachmentsSnapshot().pending["session-a"]).toHaveLength(1);
  });

  it("跨发送残留闸:后续无附件的发送失效旧消费名单,undo 不回滚", () => {
    registerIntentCanvasSendTransform();
    aiEnabled = false;
    stageAttachment("session-a", doc);
    capturedTransform!("第一封", "session-a"); // 成功消费
    capturedTransform!("第二封", "session-a"); // 无附件的新一轮
    capturedUndo!();
    expect(attachmentsSnapshot().pending["session-a"]).toHaveLength(0);
  });

  it("consume 后 pending 为空、restore 恢复", () => {
    stageAttachment("s2", doc);
    const consumed = consumeAttachments("s2");
    expect(consumed).toHaveLength(1);
    expect(attachmentsSnapshot().pending["s2"]).toHaveLength(0);
    restoreAttachments("s2", consumed);
    expect(attachmentsSnapshot().pending["s2"]).toHaveLength(1);
  });
});
