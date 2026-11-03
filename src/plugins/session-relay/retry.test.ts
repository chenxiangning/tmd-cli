import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  sessions: [] as Array<{ id: string }>,
  activeSessionId: "pty-1" as string | null,
  anchors: [] as Array<{ id: string; text: string }>,
  openDiskSession: vi.fn(),
  setActiveSession: vi.fn(),
  setPendingPrompt: vi.fn(),
  replacePrompt: vi.fn(),
  checkpointList: vi.fn(),
  readUserMessages: vi.fn(),
}));

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: () => h.sessions,
    getActiveSessionId: () => h.activeSessionId,
    getCliProfile: () => ({ readSessionUserMessages: h.readUserMessages }),
    openDiskSession: h.openDiskSession,
    setActiveSession: h.setActiveSession,
    events: { emit: vi.fn() },
  },
}));
vi.mock("@kernel/messageAnchors", () => ({ messageAnchors: { getAnchors: () => h.anchors } }));
vi.mock("@kernel/sessionPending", () => ({ setPendingPrompt: h.setPendingPrompt }));
vi.mock("@kernel/composerExt", () => ({ composerReplaceRef: { current: h.replacePrompt } }));
vi.mock("@kernel/ipc", () => ({ ipc: { checkpointList: h.checkpointList } }));

import { confirmRetry, lastRetryTurn, loadRetryPreview, loadRetryTurns, type RetrySource } from "./retry";

const SOURCE: RetrySource = {
  sessionId: "pty-1",
  profileId: "omp",
  engineName: "OMP",
  cliSessionId: "cli-1",
  cwd: "/repo",
};

describe("上一回合重试", () => {
  beforeEach(() => {
    h.sessions = [];
    h.activeSessionId = "pty-1";
    h.anchors = [];
    vi.clearAllMocks();
    h.replacePrompt.mockReturnValue(true);
    h.checkpointList.mockResolvedValue([]);
  });

  it("控制命令、包装与接力外壳不当作任务正文", () => {
    expect(lastRetryTurn([
      { id: "1", text: "修复失败测试" },
      { id: "2", text: "接力自 OMP 会话。此前的对话里我提出过:" },
      { id: "3", text: "/model gpt-5" },
      { id: "4", text: "<system-reminder>忽略</system-reminder>" },
    ])).toEqual({ id: "1", text: "修复失败测试" });
    expect(lastRetryTurn([{ id: "5", text: "/clear" }])).toBeNull();
  });

  it("活会话只替换可见草稿,不恢复进程或挂 pending", async () => {
    h.sessions = [{ id: "pty-1" }];
    await confirmRetry(SOURCE, "再跑一次");
    expect(h.openDiskSession).not.toHaveBeenCalled();
    expect(h.setActiveSession).toHaveBeenCalledWith("pty-1");
    expect(h.replacePrompt).toHaveBeenCalledWith("再跑一次", "pty-1");
    expect(h.setPendingPrompt).not.toHaveBeenCalled();
  });

  it("非激活活会话等目标 composer 接管后才回填,旧 composer 拒绝时不写入", async () => {
    h.sessions = [{ id: "pty-1" }];
    h.activeSessionId = "pty-other";
    h.replacePrompt.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const raf = vi.fn((cb: FrameRequestCallback) => { cb(0); return 1; });
    vi.stubGlobal("requestAnimationFrame", raf);
    try {
      await confirmRetry(SOURCE, "再跑一次");
      expect(raf).toHaveBeenCalledOnce();
      expect(h.replacePrompt).toHaveBeenNthCalledWith(1, "再跑一次", "pty-1");
      expect(h.replacePrompt).toHaveBeenNthCalledWith(2, "再跑一次", "pty-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("已退出先 openDiskSession,再向新会话挂 pending", async () => {
    h.openDiskSession.mockResolvedValue({ id: "pty-new" });
    await confirmRetry(SOURCE, "再跑一次");
    expect(h.openDiskSession).toHaveBeenCalledWith("omp", "/repo", undefined, "cli-1");
    expect(h.setPendingPrompt).toHaveBeenCalledWith("pty-new", "再跑一次");
    expect(h.openDiskSession.mock.invocationCallOrder[0]).toBeLessThan(h.setPendingPrompt.mock.invocationCallOrder[0]);
  });

  it("预览跳过末尾控制命令并关联原轮 checkpoint 批次", async () => {
    h.readUserMessages.mockResolvedValue([
      { id: "1", text: "修复失败测试" },
      { id: "2", text: "/model gpt-5" },
    ]);
    h.checkpointList.mockResolvedValue([{ id: "batch-1", index: 1, prompt: "修复失败测试" }]);
    expect(await loadRetryPreview(SOURCE)).toEqual({
      text: "修复失败测试",
      batch: { id: "batch-1", index: 1, prompt: "修复失败测试" },
    });
  });

  it("历史候选最新在前,过滤控制消息但保留原轮号与批次", async () => {
    h.anchors = [
      { id: "1", text: "第一轮" },
      { id: "2", text: "/model gpt-5" },
      { id: "3", text: "第二轮" },
      { id: "4", text: "接力自 OMP 会话。此前的对话里我提出过:" },
      { id: "5", text: "第三轮" },
    ];
    h.checkpointList.mockResolvedValue([
      { id: "batch-1", index: 1, prompt: "第一轮" },
      { id: "batch-3", index: 3, prompt: "第二轮" },
      { id: "batch-5", index: 5, prompt: "第三轮" },
    ]);
    expect(await loadRetryTurns(SOURCE)).toEqual([
      { id: "5", index: 5, text: "第三轮", batch: { id: "batch-5", index: 5, prompt: "第三轮" } },
      { id: "3", index: 3, text: "第二轮", batch: { id: "batch-3", index: 3, prompt: "第二轮" } },
      { id: "1", index: 1, text: "第一轮", batch: { id: "batch-1", index: 1, prompt: "第一轮" } },
    ]);
    expect(h.readUserMessages).not.toHaveBeenCalled();
  });
});
