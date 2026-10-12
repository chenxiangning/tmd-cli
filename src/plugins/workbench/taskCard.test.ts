/**
 * taskCard 契约测试 —— pending 卡片置/弃/读 + 发送变换的前置拼装/消费与
 * 失败回滚(relayCarry 同款乐观口径)。
 */

import { describe, expect, it } from "vitest";
import {
  dropPendingTaskCard,
  getPendingTaskCard,
  setPendingTaskCard,
  taskCardSendTransform,
  undoTaskCardSend,
} from "./taskCard";

const card = { projectId: "p1", taskId: "t1", title: "任务 A", text: "任务上下文全文" };

describe("pendingTaskCard 载荷", () => {
  it("置/读/弃:默认无,置后可读,弃后清空", () => {
    expect(getPendingTaskCard("s1")).toBeNull();
    setPendingTaskCard("s1", card);
    expect(getPendingTaskCard("s1")).toBe(card);
    dropPendingTaskCard("s1");
    expect(getPendingTaskCard("s1")).toBeNull();
  });

  it("同会话覆盖 = 新卡片替换", () => {
    setPendingTaskCard("s2", card);
    setPendingTaskCard("s2", { ...card, text: "改过的上下文" });
    expect(getPendingTaskCard("s2")?.text).toBe("改过的上下文");
    dropPendingTaskCard("s2");
  });
});

describe("taskCardSendTransform", () => {
  it("无卡片/无会话:原样返回", () => {
    expect(taskCardSendTransform("hello", "pty-x")).toBe("hello");
    expect(taskCardSendTransform("hello", null)).toBe("hello");
  });

  it("卡片前置:全文 + 空行 + 用户输入;空输入 = 仅卡片;消费后不再携带", () => {
    setPendingTaskCard("pty-1", card);
    expect(taskCardSendTransform("开始吧", "pty-1")).toBe("任务上下文全文\n\n开始吧");
    expect(getPendingTaskCard("pty-1")).toBeNull();
    expect(taskCardSendTransform("再一条", "pty-1")).toBe("再一条");
  });

  it("只消费目标会话自己的卡片,别会话不受影响", () => {
    setPendingTaskCard("pty-2", card);
    expect(taskCardSendTransform("hi", "pty-1")).toBe("hi");
    expect(getPendingTaskCard("pty-2")?.text).toBe("任务上下文全文");
    dropPendingTaskCard("pty-2");
  });

  it("失败回滚恢复被消费卡片;二次 undo 不复活", () => {
    setPendingTaskCard("pty-3", card);
    taskCardSendTransform("", "pty-3");
    expect(getPendingTaskCard("pty-3")).toBeNull();
    undoTaskCardSend();
    expect(getPendingTaskCard("pty-3")).toEqual(card);
    undoTaskCardSend();
    expect(getPendingTaskCard("pty-3")).toEqual(card);
    dropPendingTaskCard("pty-3");
  });
});
