/**
 * 审批收件箱 store 行为契约测试(mock host/ipc,不依赖真机会话)。
 * 钉:摘录提取纯函数(ANSI 剥离/末 3 行/截断)、since 首见不重置、answer 载荷、
 * 幽灵行回归(终端侧作答/自愈只 host.notify,不发 topic → host.subscribe 兜底)、
 * 后见补盲不记 since、复 ask 重拉新摘录、失败提示位。摘录失败静默不毒化。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KernelTopics, EventBus } from "@kernel/events";

/** host.subscribe 捕获:测试借此模拟 host.notify 旁路(终端侧作答/自愈路径)。 */
const hostSubs: Array<() => void> = [];

vi.mock("@kernel/host", () => ({
  host: {
    getSessions: vi.fn(() => []),
    isWaitingConfirm: vi.fn(() => false),
    writeSession: vi.fn(async () => true),
    getCliProfile: vi.fn(() => undefined),
    getCliSessionId: vi.fn(() => undefined),
    setActiveSession: vi.fn(),
    subscribe: vi.fn((fn: () => void) => {
      hostSubs.push(fn);
      return () => undefined;
    }),
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
  answerKeys,
  answerWaiting,
  approvalInboxSnapshot,
  askHistorySnapshot,
  bootApprovalInbox,
  excerptFromTail,
  gotoAndFocus,
  noteAskDetected,
  observeCurrentWaitings,
  refreshInbox,
  resetApprovalInboxForTest,
} from "./store";
import { registerTerminalHandle, unregisterTerminalHandle } from "@kernel/terminalHandles";

/** 会话表 fixture(store 只消费 id/profileId)。 */
function sessionsFixture(waiting: string[]): SessionMeta[] {
  return waiting.map((id) => ({ id, profileId: "omp", cwd: "/repo" }));
}

beforeEach(() => {
  resetApprovalInboxForTest();
  hostSubs.length = 0;
  vi.mocked(host.getSessions).mockReturnValue([]);
  vi.mocked(host.isWaitingConfirm).mockReturnValue(false);
  vi.mocked(host.writeSession).mockResolvedValue(true);
  vi.mocked(ipc.sessionLogSize).mockResolvedValue(0);
  vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text: "", startOffset: 0, hasMore: false });
});

/** 喂入摘录用日志尾桩。 */
function stubTail(text: string): void {
  vi.mocked(ipc.sessionLogSize).mockResolvedValue(4096);
  vi.mocked(ipc.sessionHistoryPage).mockResolvedValue({ text, startOffset: 0, hasMore: false });
}

describe("excerptFromTail 纯函数", () => {
  it("剥 ANSI、取末 3 个非空行、保留行内空格结构", () => {
    const tail = "\u001b]0;title\u0007垃圾头\r\n\r\n第一行提示\r\n  ❯ 1. Yes\r\n  2. No\r\n";
    expect(excerptFromTail(tail)).toBe("第一行提示\n❯ 1. Yes\n2. No");
  });

  it("超 120 字符的行截断", () => {
    const long = "x".repeat(200);
    const out = excerptFromTail(long);
    expect(out.length).toBe(120);
    expect(out).toBe("x".repeat(120));
  });
});

describe("等待快照", () => {
  it("isWaitingConfirm 会话进快照;消退后行移除且缓存清理", () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a", "b"]));
    vi.mocked(host.isWaitingConfirm).mockImplementation((id) => id === "a");
    noteAskDetected("a");
    expect(approvalInboxSnapshot().entries.map((e) => e.sessionId)).toEqual(["a"]);
    expect(approvalInboxSnapshot().entries[0].since).not.toBeNull();

    /* 作答后 a 消退(写后抑制窗防复燃是 askWatch 侧契约,此处只钉视图消退) */
    vi.mocked(host.isWaitingConfirm).mockImplementation(() => false);
    refreshInbox();
    expect(approvalInboxSnapshot().entries).toEqual([]);
  });

  it("since 首见记时,重复 askDetected(重绘)不重置", () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    const first = approvalInboxSnapshot().entries[0].since;
    expect(first).not.toBeNull();
    noteAskDetected("a");
    expect(approvalInboxSnapshot().entries[0].since).toBe(first);
  });

  it("等待最久者在前;无 since 的(面板后见)排最后", () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["late", "early"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("early");
    refreshInbox(); /* late 只出现在会话表,未见边沿 */
    const ids = approvalInboxSnapshot().entries.map((e) => e.sessionId);
    expect(ids).toEqual(["early", "late"]);
    expect(approvalInboxSnapshot().entries[1].since).toBeNull();
  });
});

describe("摘录", () => {
  it("askDetected 拉日志尾,剥 ANSI 后上快照", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    stubTail("Some frame\r\nAllow Bash command: pnpm test?\r\n❯ 1. Yes\r\n");
    noteAskDetected("a");
    await vi.waitFor(() => {
      expect(approvalInboxSnapshot().entries[0].excerpt).toContain("Allow Bash command: pnpm test?");
    });
  });

  it("日志为 0(懒落盘)摘录置空,不报错不毒化", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    await vi.waitFor(() => approvalInboxSnapshot().entries.length > 0);
    expect(approvalInboxSnapshot().entries[0].excerpt).toBeNull();
  });

  it("作答消退后缓存清零,复 ask 重拉到新摘录", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    stubTail("old question\r\nAllow old?\r\n");
    noteAskDetected("a");
    await vi.waitFor(() => approvalInboxSnapshot().entries[0].excerpt?.includes("Allow old?") === true);

    /* 作答 → 行消退(缓存随 refreshInbox 清理)→ 新一轮 ask,面板已换问题 */
    vi.mocked(host.isWaitingConfirm).mockReturnValue(false);
    refreshInbox();
    stubTail("new question\r\nAllow new-command?\r\n");
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    await vi.waitFor(() => {
      expect(approvalInboxSnapshot().entries[0].excerpt).toContain("Allow new-command?");
    });
  });
});

describe("幽灵行回归(非收件箱路径的状态位变化)", () => {
  it("终端侧作答(只 host.notify,无 topic)经 host.subscribe 重算即消退", () => {
    const events = new EventBus();
    bootApprovalInbox(events);
    expect(hostSubs.length).toBe(1); /* boot 恰挂一条 host.subscribe */
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    events.emit<string>(KernelTopics.askDetected, "a");
    expect(approvalInboxSnapshot().entries.map((e) => e.sessionId)).toEqual(["a"]);

    /* 用户在终端直接答 y:askWatch 清位只 host.notify,不发 kernel 事件 */
    vi.mocked(host.isWaitingConfirm).mockReturnValue(false);
    hostSubs[0]();
    expect(approvalInboxSnapshot().entries).toEqual([]);
  });

  it("boot 前 askDetected 丢失的场景:observeCurrentWaitings 补盲且不假造时长", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["late"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    stubTail("late panel\r\nAllow late-command?\r\n");
    observeCurrentWaitings();
    await vi.waitFor(() => approvalInboxSnapshot().entries.length > 0);
    const entry = approvalInboxSnapshot().entries[0];
    expect(entry.sessionId).toBe("late");
    expect(entry.since).toBeNull(); /* 真实提问时刻不可知 → 「等待中」,不从 0 假起走 */
    await vi.waitFor(() => {
      expect(approvalInboxSnapshot().entries[0].excerpt).toContain("Allow late-command?");
    });
  });
});

describe("应答", () => {
  it("原文追加换行走 host.writeSession 唯一写入口;失败返回 false 不抛", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    await expect(answerWaiting("a", "y")).resolves.toBe(true);
    expect(host.writeSession).toHaveBeenCalledWith("a", "y\n", false);

    vi.mocked(host.writeSession).mockResolvedValue(false);
    await expect(answerWaiting("a", "n")).resolves.toBe(false);
  });

  it("answerKeys 裸键代发:原样写入不追加换行(multi 卡 toggle/移动序列依赖)", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    await expect(answerKeys("a", "\x1b[B ")).resolves.toBe(true);
    expect(host.writeSession).toHaveBeenCalledWith("a", "\x1b[B ", true);
  });

  it("写失败落 failure 提示位(行已消退,横幅兜底);成功作答清位", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a", "b"]));
    vi.mocked(host.isWaitingConfirm).mockReturnValue(true);
    noteAskDetected("a");
    noteAskDetected("b");

    vi.mocked(host.writeSession).mockResolvedValue(false);
    await answerWaiting("a", "retry");
    expect(approvalInboxSnapshot().failure).toBe("a");

    /* a 已不在等待表时重算清位;成功作答 b 同样清位 */
    vi.mocked(host.writeSession).mockResolvedValue(true);
    await answerWaiting("b", "y");
    expect(approvalInboxSnapshot().failure).toBeNull();
  });
});

describe("直达聚焦(拒绝引导:把人送进幕布)", () => {
  /** 最小窄接口替身:只 focus 有断言意义,其余成员占位。 */
  function fakeHandle(focus: () => void) {
    return {
      lineText: () => "", bufferLength: () => 0, viewportTop: () => 0, rows: () => 24,
      scrollToLine: () => undefined, focus, onScroll: () => () => undefined,
      hasMoreHistory: () => false, loadEarlier: async () => undefined,
    } as Parameters<typeof registerTerminalHandle>[1];
  }

  it("gotoAndFocus:切激活会话并聚焦在册幕布(composer 焦点移交同款)", async () => {
    const focus = vi.fn();
    const handle = fakeHandle(focus);
    registerTerminalHandle("a", handle);
    gotoAndFocus("a");
    expect(host.setActiveSession).toHaveBeenCalledWith("a");
    expect(focus).toHaveBeenCalledTimes(1);
    unregisterTerminalHandle("a", handle);
  });

  it("幕布未挂载(handle 缺席):仍切激活,静默不抛", () => {
    vi.mocked(host.setActiveSession).mockClear();
    gotoAndFocus("ghost");
    expect(host.setActiveSession).toHaveBeenCalledWith("ghost");
  });
});

describe("ask 历史落盘", () => {
  it("卡解析成功即入历史(同指纹去重);退出等待清指纹后复问重记", async () => {
    vi.mocked(host.getSessions).mockReturnValue(sessionsFixture(["a"]));
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
});
