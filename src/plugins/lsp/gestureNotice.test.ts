/**
 * gestureNotice 契约测试 —— noticeDue 纯函数节流判定 + store 侧到期内静默。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  GESTURE_NOTICE_THROTTLE_MS,
  gestureNoticeSnapshot,
  noticeDue,
  resetGestureNoticeForTest,
  showGestureNotice,
  type GestureNoticeKey,
} from "./gestureNotice";

const SLOTS: Record<GestureNoticeKey, number | null> = { "server-error": null, "no-language": null };

describe("noticeDue(纯函数)", () => {
  it("从未弹过(null)即到期", () => {
    expect(noticeDue({ ...SLOTS }, "server-error", 1_000)).toBe(true);
  });

  it("节流窗内不再到期;恰满窗边界到期", () => {
    const slots = { ...SLOTS, "server-error": 1_000 };
    expect(noticeDue(slots, "server-error", 1_000 + GESTURE_NOTICE_THROTTLE_MS - 1)).toBe(false);
    expect(noticeDue(slots, "server-error", 1_000 + GESTURE_NOTICE_THROTTLE_MS)).toBe(true);
    expect(noticeDue(slots, "server-error", 1_000 + GESTURE_NOTICE_THROTTLE_MS + 1)).toBe(true);
  });

  it("两条出口时间槽互不挤占", () => {
    const slots = { ...SLOTS, "server-error": 1_000 };
    expect(noticeDue(slots, "no-language", 1_500)).toBe(true);
    expect(noticeDue(slots, "server-error", 1_500)).toBe(false);
  });

  it("支持自定义节流窗", () => {
    const slots = { ...SLOTS, "no-language": 100 };
    expect(noticeDue(slots, "no-language", 150, 60)).toBe(false);
    expect(noticeDue(slots, "no-language", 160, 60)).toBe(true);
  });
});

describe("showGestureNotice(store 节流)", () => {
  beforeEach(() => {
    resetGestureNoticeForTest();
  });

  it("首次上屏;同出口窗内重复静默,换出口不受影响", () => {
    showGestureNotice("server-error", "a", 1_000);
    expect(gestureNoticeSnapshot().notice?.message).toBe("a");
    showGestureNotice("server-error", "b", 2_000);
    expect(gestureNoticeSnapshot().notice?.message).toBe("a"); // 被节流
    showGestureNotice("no-language", "c", 3_000);
    expect(gestureNoticeSnapshot().notice?.message).toBe("c"); // 独立槽
    showGestureNotice("server-error", "d", 1_000 + GESTURE_NOTICE_THROTTLE_MS);
    expect(gestureNoticeSnapshot().notice?.message).toBe("d"); // 窗满再弹
  });

  it("每次到期上屏 seq 递增(驱动 toast 重挂重计时)", () => {
    showGestureNotice("server-error", "x", 1_000);
    const first = gestureNoticeSnapshot().notice?.seq;
    showGestureNotice("server-error", "y", 1_000 + GESTURE_NOTICE_THROTTLE_MS);
    expect(gestureNoticeSnapshot().notice!.seq).toBeGreaterThan(first!);
  });
});
