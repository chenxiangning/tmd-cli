/** restoreTail 写后闸(评审 F4)—— 刚作答的会话,尾巴里的面板标记是已答残影,
 *  恢复喂入会在写后抑制窗外立新候选,静默期漂移确认后升级假 waiting。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskWatchFeed } from "./askWatchFeed";

function makeFeed() {
  return new AskWatchFeed({
    sessionKind: () => "cli",
    askMarks: () => [/Ask \d+ questions?/],
    emitAsked: () => undefined,
    notify: () => undefined,
    bufferTail: () => "",
  });
}

const TAIL_WITH_MARK = "上一轮输出\nAsk 1 questions\n";

describe("restoreTail 写后闸", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("写后抑制窗内不喂尾:面板残影不立候选不升级", async () => {
    const feed = makeFeed();
    feed.onUserWrite("s");
    feed.restoreTail("s", TAIL_WITH_MARK);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(feed.isWaiting("s")).toBe(false);
  });

  it("无近期写入正常喂尾:标记尾巴经漂移确认升级 waiting", async () => {
    const feed = makeFeed();
    feed.restoreTail("s", TAIL_WITH_MARK);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(feed.isWaiting("s")).toBe(true);
  });

  it("抑制窗过后喂尾恢复正常", async () => {
    const feed = makeFeed();
    feed.onUserWrite("s");
    await vi.advanceTimersByTimeAsync(8_100);
    feed.restoreTail("s", TAIL_WITH_MARK);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(feed.isWaiting("s")).toBe(true);
  });
});
