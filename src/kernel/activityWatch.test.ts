/**
 * 轮次开启闸单元测试(2026-09-08)—— 直接构造 ActivityWatch 钉谓词矩阵;
 * host 级集成路径(真 sessionTabs 接线)见 host.unread.test.ts。
 *
 * 契约:tab 已关且无未应答写入的已了结 CLI 会话,新输出(异步噪音)不开轮;
 * ssh/shell「输出即活动」语义豁免闸门 —— 远端长任务(make 静默数分钟后
 * 输出完工)关 tab 后必须照常开轮、结算标未读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityWatch } from "./activityWatch";

function makeWatch(opts: { gated?: boolean } = {}) {
  const openTabs = new Set<string>();
  const viewing = new Set<string>();
  const watch = new ActivityWatch({
    isViewing: (id) => viewing.has(id),
    exists: () => true,
    hasOpenTab: (id) => openTabs.has(id),
    noiseGated: () => opts.gated ?? true,
    onChange: () => undefined,
    onTurnSettled: () => undefined,
  });
  return { watch, openTabs, viewing };
}

describe("轮次开启闸", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("关 tab 的已了结会话:噪音不开轮、不推进活动钟、不标未读", () => {
    const { watch, openTabs, viewing } = makeWatch();
    openTabs.add("s");
    viewing.add("s");
    watch.onUserWrite("s");
    watch.onOutput("s");
    vi.advanceTimersByTime(3000); // 结算:正在查看 → 已查看
    const settledAt = watch.lastActivityAt("s");

    openTabs.delete("s"); // 关 tab(会话保持运行)
    viewing.delete("s");
    expect(watch.onOutput("s")).toBe(false); // 异步噪音被闸挡
    vi.advanceTimersByTime(3000);
    expect(watch.isTurnActive("s")).toBe(false);
    expect(watch.lastActivityAt("s")).toBe(settledAt);
    expect(watch.isUnread("s")).toBe(false);
  });

  it("ssh/shell 豁免:关 tab 后长任务完工输出照常开轮、结算标未读", () => {
    const { watch, openTabs, viewing } = makeWatch({ gated: false });
    openTabs.add("sh");
    viewing.add("sh");
    watch.onUserWrite("sh"); // make\r
    watch.onOutput("sh"); // 初期输出,用户在看
    vi.advanceTimersByTime(3000); // viewed 结算

    openTabs.delete("sh"); // 关 tab
    viewing.delete("sh");
    watch.onOutput("sh"); // 编译静默后输出完工(豁免闸门)
    expect(watch.isTurnActive("sh")).toBe(true);
    vi.advanceTimersByTime(3000);
    expect(watch.isUnread("sh")).toBe(true); // 完工通知不丢
  });
});
