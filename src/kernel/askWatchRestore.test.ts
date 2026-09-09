/**
 * AskWatch boot 恢复行为契约测试(askWatchRestore)—— webview 全量重载清空
 * 内存态后,boot 从磁盘日志尾恢复等待状态(修「后台会话收不到 ask 提示,
 * 必须打开才能收到」)。覆盖:等待面板日志尾恢复升级(标签 + askDetected)、
 * 已作答尾巴(无标记)零副作用、ssh 与无日志会话跳过。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/* ipc mock(含 boot 恢复要读的日志三件套);hoisted 供用例内改写返回。 */
const logMocks = vi.hoisted(() => ({
  sessionList: vi.fn(),
  sessionLogSize: vi.fn(),
  sessionHistoryPage: vi.fn(),
}));

vi.mock("./ipc", () => ({
  ipc: {
    sessionList: (id?: string) => logMocks.sessionList(id),
    sessionLogSize: (id: string) => logMocks.sessionLogSize(id),
    sessionHistoryPage: (id: string, before: number, maxBytes: number) =>
      logMocks.sessionHistoryPage(id, before, maxBytes),
    sessionSpawn: vi.fn(async () => ({ id: "unused", pid: 1 })),
    sessionKill: vi.fn(async () => undefined),
    sessionWrite: vi.fn(async () => undefined),
  },
  onPtyOutput: vi.fn(async () => () => undefined),
  onPtyExit: vi.fn(async () => () => undefined),
}));

import { bootAskRestore } from "./askWatchRestore";
import { host } from "./host";
import { KernelTopics } from "./events";

/** omp Ask 面板样例(带 ANSI 样式,取自真实输出形态)。 */
const OMP_ASK =
  "\x1b[1mAsk 1 questions\x1b[0m\r\n\x1b[2m[plan_confirm] · options:3\x1b[0m";

/** 测试用 CLI 声明标记(同 askWatch.host.test.ts 口径)。 */
const TEST_ASK_MARKS: RegExp[] = [
  /Ask \d+ questions?/,
  /Enter select\b/,
  /Esc(?: to)? cancel\b/,
];

describe("bootAskRestore 磁盘日志尾恢复", () => {
  const PROFILE_ID = "ask-restore-cli";

  beforeEach(() => {
    vi.useFakeTimers();
    logMocks.sessionList.mockResolvedValue([]);
    logMocks.sessionLogSize.mockResolvedValue(4096);
    logMocks.sessionHistoryPage.mockResolvedValue({
      text: "",
      startOffset: 0,
      hasMore: false,
    });
    if (!host.getCliProfile(PROFILE_ID)) {
      host.registerCliProfile({
        id: PROFILE_ID,
        name: "ask-restore-test",
        command: "true",
        args: [],
        triggers: [],
        askMarks: TEST_ASK_MARKS,
      });
    }
  });

  afterEach(() => {
    host.resetStatusTimerForTest();
    host.resetActivityWatchForTest();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("等待面板的日志尾 → 恢复升级(askDetected + isWaitingConfirm)", async () => {
    logMocks.sessionList.mockResolvedValue([
      { id: "restore-1", profileId: PROFILE_ID, cwd: "/proj" },
    ]);
    logMocks.sessionHistoryPage.mockResolvedValue({
      text: OMP_ASK,
      startOffset: 0,
      hasMore: false,
    });
    const detected: string[] = [];
    const off = host.events.on<string>(KernelTopics.askDetected, (id) =>
      detected.push(id),
    );
    bootAskRestore();
    await vi.advanceTimersByTimeAsync(50);
    expect(host.isWaitingConfirm("restore-1")).toBe(false); /* 先立候选 */
    await vi.advanceTimersByTimeAsync(2_500);
    expect(host.isWaitingConfirm("restore-1")).toBe(true); /* 漂移确认升级 */
    expect(detected).toEqual(["restore-1"]);
    off();
  });

  it("已作答尾巴(无标记)零副作用;ssh 会话跳过不读日志", async () => {
    logMocks.sessionList.mockResolvedValue([
      { id: "restore-2", profileId: PROFILE_ID, cwd: "/proj" },
      { id: "ssh-1", profileId: "ssh", cwd: "/proj", kind: "ssh" },
    ]);
    logMocks.sessionHistoryPage.mockResolvedValue({
      text: "普通输出,无面板字面量\n",
      startOffset: 0,
      hasMore: false,
    });
    bootAskRestore();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(host.isWaitingConfirm("restore-2")).toBe(false);
    expect(host.isWaitingConfirm("ssh-1")).toBe(false);
    expect(logMocks.sessionLogSize).not.toHaveBeenCalledWith("ssh-1");
  });
});
