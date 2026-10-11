/**
 * kernel 待注入槽(composerExt)契约:先入先出单槽 + 挂载点一次性消费 + TTL。
 */

import { describe, expect, it } from "vitest";
import { clearQueuedComposerText, queueComposerText, takeQueuedComposerText } from "./composerExt";

describe("composerExt 待注入槽", () => {
  it("queue 后 take 返回同文本,且二次 take 为空(一次性消费)", () => {
    queueComposerText("任务包 A");
    expect(takeQueuedComposerText()).toBe("任务包 A");
    expect(takeQueuedComposerText()).toBeNull();
    expect(takeQueuedComposerText()).toBeNull();
  });

  it("未 queue 时 take 为空", () => {
    expect(takeQueuedComposerText()).toBeNull();
  });

  it("重复 queue 以最后一次为准", () => {
    queueComposerText("第一版");
    queueComposerText("第二版");
    expect(takeQueuedComposerText()).toBe("第二版");
    expect(takeQueuedComposerText()).toBeNull();
  });

  it("clear 作废未消费文本(创建失败防泄漏)", () => {
    queueComposerText("将失败的任务包");
    clearQueuedComposerText();
    expect(takeQueuedComposerText()).toBeNull();
  });
});
