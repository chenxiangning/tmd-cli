import { beforeEach, describe, expect, it } from "vitest";
import { dropPendingPrompt, getPendingPrompt, setPendingPrompt } from "@kernel/sessionPending";
import { getPendingRefs, setPendingRefs } from "./refStore";
import { animRefsSendTransform, undoAnimRefsSend } from "./sessionRefs";

describe("animRefsSendTransform", () => {
  beforeEach(() => {
    undoAnimRefsSend();
  });

  it("提示词前置 + 引用块后置 + 用户输入居中;消费后清空", () => {
    setPendingPrompt("s1", "初始提示词全文");
    setPendingRefs("s1", [{ label: "协议 schema", path: "/p/schema.md" }]);
    expect(animRefsSendTransform("补充一句", "s1")).toBe(
      "初始提示词全文\n\n补充一句\n\n引用文件:\n- 协议 schema:/p/schema.md",
    );
    expect(getPendingPrompt("s1")).toBeNull();
    expect(getPendingRefs("s1")).toHaveLength(0);
  });

  it("空输入 = 提示词 + 引用块;仅引用也合法", () => {
    setPendingRefs("s2", [{ label: "目标项目", path: "/p/a.json" }]);
    expect(animRefsSendTransform("", "s2")).toBe("引用文件:\n- 目标项目:/p/a.json");
  });

  it("无 sessionId / 无 pending 原样放行", () => {
    expect(animRefsSendTransform("正文", null)).toBe("正文");
    expect(animRefsSendTransform("正文", "s-none")).toBe("正文");
  });

  it("undo 恢复最后一次消费的提示词与引用", () => {
    setPendingPrompt("s3", "提示词");
    setPendingRefs("s3", [{ label: "协议示例", path: "/p/b.json" }]);
    animRefsSendTransform("hi", "s3");
    expect(getPendingPrompt("s3")).toBeNull();
    undoAnimRefsSend();
    expect(getPendingPrompt("s3")).toBe("提示词");
    expect(getPendingRefs("s3")).toEqual([{ label: "协议示例", path: "/p/b.json" }]);
  });

  it("丢弃提示词卡后发送不再携带", () => {
    setPendingPrompt("s4", "临时提示词");
    dropPendingPrompt("s4");
    expect(animRefsSendTransform("正文", "s4")).toBe("正文");
  });
});
