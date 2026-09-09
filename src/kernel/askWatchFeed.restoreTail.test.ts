import { beforeEach, describe, expect, it, vi } from "vitest";
import { AskWatchFeed, type AskWatchFeedCtx } from "./askWatchFeed";

/* 带通用标记(y/n)的输出,供内核兜底正则命中 */
const ASK_MARK = "Allow this action? (y/n)";
const RESTORE_TAIL = `x\r\n${ASK_MARK}\r\n`;

function makeFeed(): AskWatchFeed {
  return new AskWatchFeed({
    sessionKind: () => undefined,
    bufferTail: () => RESTORE_TAIL,
    askMarks: () => undefined,
    emitAsked: () => undefined,
    notify: () => undefined,
  } satisfies AskWatchFeedCtx);
}

describe("AskWatch 磁盘尾恢复闸(restoreDiskTail,走法 1 冷开回放)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("无近期写入:尾巴带 Ask 标记 → 立候选,漂移确认后升级 waiting(碑帧徽章恢复)", () => {
    const feed = makeFeed();
    feed.restoreDiskTail("s1", RESTORE_TAIL);
    expect(feed.isWaiting("s1")).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("s1")).toBe(true);
  });

  it("回放窗内用户写入(写后 8s 闸):残影尾巴不升级(F4)", () => {
    const feed = makeFeed();
    feed.onUserWrite("s1");
    feed.restoreDiskTail("s1", RESTORE_TAIL);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("s1")).toBe(false);
  });

  it("写入超过 8s 后闸过期:尾巴标记正常升级", () => {
    const feed = makeFeed();
    feed.onUserWrite("s1");
    vi.advanceTimersByTime(8_100);
    feed.restoreDiskTail("s1", RESTORE_TAIL);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("s1")).toBe(true);
  });

  it("会话移除清理写后闸时刻:同 id 复用不受旧闸压制", () => {
    const feed = makeFeed();
    feed.onUserWrite("s1");
    feed.onSessionRemoved("s1");
    feed.restoreDiskTail("s1", RESTORE_TAIL);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("s1")).toBe(true);
  });
});

describe("AskWatch 无闸恢复(restoreTail:boot/重挂载补观察)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("已有无关 waiting 的会话不受恢复影响", () => {
    const feed = makeFeed();
    feed.onOutput("other", `${ASK_MARK}\r\n`, 30);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("other")).toBe(true);
    feed.restoreTail("other", RESTORE_TAIL);
    vi.advanceTimersByTime(2000);
    expect(feed.isWaiting("other")).toBe(true);
  });
});
