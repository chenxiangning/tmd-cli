/**
 * 发送入史闸回归:promptHistoryEnabled 关闭时发送成功但不记 ↑ 召回史。
 * sendPlan 等重依赖桩掉,只验证执行段 recordPrompt 的闸口径。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordPrompt = vi.hoisted(() => vi.fn());
const getSettingsState = vi.hoisted(() =>
  vi.fn(() => ({ settings: { promptHistoryEnabled: true } })),
);
const writeSession = vi.hoisted(() => vi.fn(async () => true));
const emitPromptSent = vi.hoisted(() => vi.fn());

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => [{ id: "s1", profileId: "p1" }],
    getCliProfile: () => ({ id: "p1", name: "claude" }),
    getActiveSessionId: () => "s1",
    writeSession,
    events: { emit: vi.fn() },
  },
}));
vi.mock("./sendPlan", () => ({
  setSendExecuting: vi.fn(),
  isConfirmPending: () => false,
  buildSinglePlan: (_sid: string, content: string) => ({
    kind: "single",
    targets: [{ id: "s1" }],
    content,
  }),
  buildBroadcastPlan: () => ({ kind: "broadcast", targets: [], content: "" }),
}));
vi.mock("@kernel/sessionTabs", () => ({ getSessionTabs: () => [], getSessionTile: () => null }));
vi.mock("./broadcastMode", () => ({ broadcastModeRef: { current: false } }));
vi.mock("@kernel/promptGate", () => ({
  readPromptGate: () => ({}),
  shouldBroadcastPrompt: () => false,
  emitPromptSent,
}));
vi.mock("@kernel/profileSend", () => ({ prepareSendPayload: () => ({}) }));
vi.mock("@kernel/promptHistory", () => ({ recordPrompt }));
vi.mock("@kernel/settings", () => ({ getSettingsState }));
vi.mock("../state/attachments", () => ({ clearAttachments: vi.fn() }));

import { useComposerSend } from "./useComposerSend";

function makeSend(value: string) {
  const send = useComposerSend({
    profile: { id: "p1" } as never,
    value,
    setValue: vi.fn(),
    clearMatches: vi.fn(),
    onSendError: vi.fn(),
    confirmEnabled: false,
    requestConfirm: vi.fn(),
  });
  return () => send();
}

describe("useComposerSend 发送入史闸", () => {
  beforeEach(() => {
    recordPrompt.mockClear();
    emitPromptSent.mockClear();
    writeSession.mockClear();
    getSettingsState.mockClear();
    getSettingsState.mockImplementation(() => ({ settings: { promptHistoryEnabled: true } }));
  });

  it("闸开:发送成功记史一次", async () => {
    await makeSend("hello")();
    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(recordPrompt).toHaveBeenCalledTimes(1);
    expect(recordPrompt).toHaveBeenCalledWith("hello");
  });

  it("闸关:发送成功但历史不增长", async () => {
    getSettingsState.mockImplementation(() => ({ settings: { promptHistoryEnabled: false } }));
    await makeSend("hello")();
    expect(writeSession).toHaveBeenCalledTimes(1);
    expect(recordPrompt).not.toHaveBeenCalled();
  });
});
