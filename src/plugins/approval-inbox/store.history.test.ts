/**
 * ask 历史落盘契约测试(自 store.test.ts 拆出,300 行铁则)。
 * 钉:卡解析成功入档(指纹去重/复问重记)、会话绑定(非激活会话问答不入档)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: vi.fn(() => []),
    isWaitingConfirm: vi.fn(() => false),
    writeSession: vi.fn(async () => true),
    getCliProfile: vi.fn(() => undefined),
    getCliSessionId: vi.fn(() => undefined),
    setActiveSession: vi.fn(),
    getActiveSessionId: vi.fn(() => null),
    subscribe: vi.fn(() => () => undefined),
  },
}));
vi.mock("@kernel/ipc", () => ({
  ipc: {
    sessionLogSize: vi.fn(async () => 0),
    sessionHistoryPage: vi.fn(async () => ({ text: "", startOffset: 0, hasMore: false })),
  },
}));

import { host } from "@kernel/host";
import { ipc, type SessionMeta } from "@kernel/ipc";
import {
  approvalInboxSnapshot,
  askHistorySnapshot,
  noteAskDetected,
  refreshInbox,
  resetApprovalInboxForTest,
} from "./store";

function sessionsFixture(waiting: string[]): SessionMeta[] {
  return waiting.map((id) => ({ id, profileId: "omp", cwd: "/repo" }));
}

beforeEach(() => {
  resetApprovalInboxForTest();
  vi.mocked(host.getSessions).mockReturnValue([]);
  vi.mocked(host.isWaitingConfirm).mockReturnValue(false);
  vi.mocked(host.getActiveSessionId).mockReturnValue(null);
  vi.mocked(ipc.sessionLogSize).mockResolvedValue(0);
  vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text: "", startOffset: 0, hasMore: false });
});

function stubTail(text: string): void {
  vi.mocked(ipc.sessionLogSize).mockResolvedValue(4096);
  vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text, startOffset: 0, hasMore: false });
}

describe("ask 历史落盘", () => {
  it("卡解析成功即入历史(同指纹去重);退出等待清指纹后复问重记", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.getActiveSessionId).mockReturnValue("a"); /* 会话绑定:正在查看才入档 */
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    stubTail(
      [
        "Ask",
        "开发节奏  Submit",
        "接下来想推进哪块工作?",
        "❯ ● PR #40 收尾",
        "  ○ 推进 0.2.6 russh",
        "← select · n note · ⌘ cancel",
      ].join("\r\n"),
    );
    noteAskDetected("a");
    await vi.waitFor(() => expect(askHistorySnapshot().length).toBe(1));
    expect(askHistorySnapshot()[0].question).toBe("接下来想推进哪块工作?");
    /* 同卡重拉(1.5s 重同步路径)不重复入档 */
    noteAskDetected("a");
    await vi.waitFor(() => approvalInboxSnapshot().entries.length > 0);
    expect(askHistorySnapshot().length).toBe(1);
    /* 消退 → 复问同题:重记 */
    vi.mocked(host.isWaitingConfirm).mockReturnValue(false);
    refreshInbox();
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    await vi.waitFor(() => expect(askHistorySnapshot().length).toBe(2));
  });

  it("会话绑定:非激活会话的问答不入档(跨会话不互泄)", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["bg"]));
    vi.mocked(host.getActiveSessionId).mockReturnValue("other"); /* 正在看别的会话 */
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    stubTail(
      [
        "Ask",
        "后台问题  Submit",
        "后台会话在问什么?",
        "❯ ○ 选项一",
        "  ○ 选项二",
        "← select · n note · ⌘ cancel",
      ].join("\r\n"),
    );
    noteAskDetected("bg");
    await vi.waitFor(() =>
      expect(approvalInboxSnapshot().entries[0].card?.question).toBe("后台会话在问什么?"),
    ); /* 等待行照旧(卡解析到位) */
    expect(askHistorySnapshot().length).toBe(0); /* 但不入历史 */
  });
});
