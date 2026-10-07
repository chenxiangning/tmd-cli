/**
 * relayCarry 契约测试 —— 发送变换的前置拼装/消费与失败回滚恢复。
 * 变换语义:pending 摘要前置 + 空行接用户输入(空输入 = 仅摘要);消费即弃
 * (芯片消失),全部目标写失败经 undo 恢复(marks lastFlip 同款乐观口径)。
 */
import { describe, expect, it } from "vitest";
import { relaySendTransform, undoRelaySend } from "./relayCarry";
import { getPendingRelay, setPendingRelay, dropPendingRelay } from "./relayStore";
import type { RelaySource } from "./relay";

const src: RelaySource = { profileId: "omp", engineName: "omp" };

describe("relaySendTransform", () => {
  it("无 pending / 无会话:原样返回", () => {
    expect(relaySendTransform("hello", "pty-x")).toBe("hello");
    expect(relaySendTransform("hello", null)).toBe("hello");
  });

  it("pending 前置:摘要 + 空行 + 用户输入;空输入 = 仅摘要;消费后不再携带", () => {
    setPendingRelay("pty-1", { text: "摘要全文", truncated: false, source: src });
    expect(relaySendTransform("继续修", "pty-1")).toBe("摘要全文\n\n继续修");
    expect(getPendingRelay("pty-1")).toBeNull();
    expect(relaySendTransform("再一条", "pty-1")).toBe("再一条");

    setPendingRelay("pty-1", { text: "摘要全文", truncated: false, source: src });
    expect(relaySendTransform("", "pty-1")).toBe("摘要全文");
    dropPendingRelay("pty-1");
  });

  it("只消费目标会话自己的 pending,别会话不受影响", () => {
    setPendingRelay("pty-2", { text: "B 摘要", truncated: false, source: src });
    expect(relaySendTransform("hi", "pty-1")).toBe("hi");
    expect(getPendingRelay("pty-2")?.text).toBe("B 摘要");
    dropPendingRelay("pty-2");
  });
});

describe("undoRelaySend", () => {
  it("消费后 undo 恢复同载荷;无消费 undo 幂等", () => {
    expect(undoRelaySend()).toBeUndefined(); /* 无消费:no-op 不抛 */
    setPendingRelay("pty-3", { text: "要恢复的", truncated: true, source: src });
    relaySendTransform("go", "pty-3");
    expect(getPendingRelay("pty-3")).toBeNull();
    undoRelaySend();
    expect(getPendingRelay("pty-3")).toMatchObject({ text: "要恢复的", truncated: true });
    undoRelaySend(); /* 二次 undo 不复活旧名单 */
    expect(getPendingRelay("pty-3")).toMatchObject({ text: "要恢复的" });
    dropPendingRelay("pty-3");
  });

  it("多次消费只回滚最后一次(与单次发送失败语义一致)", () => {
    setPendingRelay("pty-4", { text: "第一次", truncated: false, source: src });
    relaySendTransform("", "pty-4");
    setPendingRelay("pty-5", { text: "第二次", truncated: false, source: src });
    relaySendTransform("", "pty-5");
    undoRelaySend();
    expect(getPendingRelay("pty-4")).toBeNull();
    expect(getPendingRelay("pty-5")?.text).toBe("第二次");
    dropPendingRelay("pty-5");
  });
});
