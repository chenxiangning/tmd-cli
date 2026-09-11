/**
 * 活会话列表比较器行为契约测试。
 * 契约:完成未读置顶;其余按 spawn 时间(createdAt)倒序 —— 排序键必须是稳定身份,
 * 两个同时流式输出的会话绝不因输出先后互换位置(会话列表抖动事故的回归防线)。
 *
 * 置顶快照有效性(短码垃圾判定):历史缺陷里置顶早于 CLI 自动命名落地时,
 * shortId 兜底串被当作标题快照持久化,全局置顶区从此永久显示短码;
 * realPinSnapshot 负责把它识别为"无快照"。
 *
 * 会话状态校准(resolveSessionStatus):状态 label 与呼吸灯共用同一状态机 ——
 * 运行时 / 空闲-未查看 / 空闲 / 从未对话不出签;进行中压过未读。
 */
import { describe, expect, it } from "vitest";
import { shortId } from "@kernel/sessionTitles";
import {
  compareLiveSessions,
  isRunningZoneCandidate,
  realPinSnapshot,
  resolveSessionStatus,
  TITLE_RESOLVE_MAX_ATTEMPTS,
  titleRetryDelay,
} from "./utils";
import type { SessionMeta } from "@kernel/ipc";

const meta = (id: string, createdAt?: number): SessionMeta => ({
  id,
  profileId: "omp",
  cwd: "/repo",
  createdAt,
});

describe("compareLiveSessions", () => {
  it("完成未读的会话置顶,与活动时间无关", () => {
    const old = meta("old", 100);
    const freshUnread = meta("fresh", 900);
    const sorted = [old, freshUnread].sort((a, b) =>
      compareLiveSessions(a, b, (id) => id === "fresh"),
    );
    expect(sorted.map((s) => s.id)).toEqual(["fresh", "old"]);
  });

  it("已读会话严格按 spawn 时间倒序:输出交错不得改变相对位置(抖动回归防线)", () => {
    const a = meta("a", 100);
    const b = meta("b", 200);
    const sorted = [a, b].sort((x, y) =>
      compareLiveSessions(x, y, () => false),
    );
    /* 修复前排序键是 lastActivityAt(输出交错即互换);修复后比较器根本不接收
       活动时间 —— 无论输出时间线如何,b(更新)恒在 a 之上 */
    expect(sorted.map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("createdAt 缺失按 0 沉底;同毫秒以 id 倒序 tie-break,跨渲染确定", () => {
    const legacy = meta("legacy", undefined);
    const z = meta("z", 100);
    const a = meta("a", 100);
    const sorted = [legacy, z, a].sort((x, y) =>
      compareLiveSessions(x, y, () => false),
    );
    expect(sorted.map((s) => s.id)).toEqual(["z", "a", "legacy"]);
  });
});

describe("realPinSnapshot", () => {
  const id = "01a066bd-2682-72df-909c-1d5336bfb21d";

  it("短码垃圾(历史缺陷持久化的 shortId)与空串均视为无快照", () => {
    expect(realPinSnapshot(shortId(id), id)).toBeUndefined();
    expect(realPinSnapshot("", id)).toBeUndefined();
  });

  it("真标题原样通过,不受其他会话短码影响", () => {
    expect(realPinSnapshot("Verify approval line features match client", id)).toBe(
      "Verify approval line features match client",
    );
    expect(realPinSnapshot(shortId("other-session-id"), id)).toBe(
      shortId("other-session-id"),
    );
  });
});

describe("resolveSessionStatus", () => {
  const NOW = 10_000;

  it("从未对话(lastActivityAt = 0,首写闸未锚定)→ none,不出签不亮灯", () => {
    expect(resolveSessionStatus(0, false, NOW, false)).toBe("none");
    expect(resolveSessionStatus(0, true, NOW, false)).toBe("none");
  });

  it("2s 活动窗内 → running;恰好 2s 出窗即不再是进行中", () => {
    expect(resolveSessionStatus(NOW - 1999, false, NOW, false)).toBe("running");
    expect(resolveSessionStatus(NOW - 2000, false, NOW, false)).not.toBe("running");
  });

  it("进行中压过未读:新输出即回 running(与 host 清未读双保险)", () => {
    expect(resolveSessionStatus(NOW - 500, true, NOW, false)).toBe("running");
  });

  it("turnActive 压过活动钟出窗:思考期 spinner 自绘冻结活动钟,标签不得提前翻结束", () => {
    expect(resolveSessionStatus(NOW - 5000, false, NOW, true)).toBe("running");
    expect(resolveSessionStatus(0, false, NOW, true)).toBe("none"); // 首写闸仍优先
  });

  it("出窗后按已查看与否分流:unread / viewed", () => {
    expect(resolveSessionStatus(NOW - 5000, true, NOW, false)).toBe("unread");
    expect(resolveSessionStatus(NOW - 5000, false, NOW, false)).toBe("viewed");
  });
});

describe("isRunningZoneCandidate", () => {
  /** 契约:运行区成员资格 = turnActive(轮次进行中,含结算待决窗)|| unread(结束未查看)。
   *  运行区(RunningZone)与工作区分组离组过滤(zoneOut)共用此判定,单向出区回组:
   *  已查看与从未对话不在区。该谓词是「一个会话同一时刻只在一个区域」原则的锁步源。 */
  it("轮次进行中在区,含结算待决窗", () => {
    expect(isRunningZoneCandidate(true, false)).toBe(true);
  });

  it("结束未查看在区,点开即出区", () => {
    expect(isRunningZoneCandidate(false, true)).toBe(true);
    expect(isRunningZoneCandidate(false, false)).toBe(false);
  });
});

describe("titleRetryDelay", () => {
  /* 自动命名补扫节奏契约(分组 hook / 运行区 / 全局置顶三处锁步):
   * 3s 起步指数退避至 24s 封顶,8 次总预算 ~2.4min —— omp 懒落盘晚 spawn
   * 35-44s、AI 命名更晚必须落在窗口内;永不命名的 CLI 到次数学止不永续轮询。 */
  it("3s 起步指数退避,24s 封顶", () => {
    expect([1, 2, 3, 4, 5].map(titleRetryDelay)).toEqual([3_000, 6_000, 12_000, 24_000, 24_000]);
  });

  it("满次数总预算覆盖懒落盘 + AI 命名窗口", () => {
    const total = Array.from({ length: TITLE_RESOLVE_MAX_ATTEMPTS }, (_, i) => titleRetryDelay(i + 1)).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(120_000);
    expect(total).toBeLessThan(180_000);
  });
});
