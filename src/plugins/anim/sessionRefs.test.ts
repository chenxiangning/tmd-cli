import { beforeEach, describe, expect, it } from "vitest";
import { getPendingPrompt, setPendingPrompt } from "@kernel/sessionPending";
import { getPendingRefs, setPendingRefs } from "./refStore";
import { animRefsSendTransform, undoAnimRefsSend } from "./sessionRefs";

describe("animRefsSendTransform", () => {
  beforeEach(() => {
    undoAnimRefsSend();
  });

  it("引用块后置 + 用户输入居中;消费后清空;提示词半区不在此消费(由 kernel 消费面负责)", () => {
    setPendingPrompt("s1", "初始提示词全文");
    setPendingRefs("s1", [{ label: "协议 schema", path: "/p/schema.md" }]);
    expect(animRefsSendTransform("补充一句", "s1")).toBe(
      "补充一句\n\n引用文件:\n- 协议 schema:/p/schema.md",
    );
    expect(getPendingRefs("s1")).toHaveLength(0);
    /* 关键断言:anim 变换不碰提示词队列(不重复消费,留给 kernel 消费面)。 */
    expect(getPendingPrompt("s1")).toBe("初始提示词全文");
  });

  it("空输入 = 仅引用块", () => {
    setPendingRefs("s2", [{ label: "目标项目", path: "/p/a.json" }]);
    expect(animRefsSendTransform("", "s2")).toBe("引用文件:\n- 目标项目:/p/a.json");
  });

  it("无 sessionId / 无 pending 原样放行", () => {
    expect(animRefsSendTransform("正文", null)).toBe("正文");
    expect(animRefsSendTransform("正文", "s-none")).toBe("正文");
  });

  it("undo 恢复最后一次消费的引用(不恢复提示词)", () => {
    setPendingRefs("s3", [{ label: "协议示例", path: "/p/b.json" }]);
    animRefsSendTransform("hi", "s3");
    expect(getPendingRefs("s3")).toHaveLength(0);
    undoAnimRefsSend();
    expect(getPendingRefs("s3")).toEqual([{ label: "协议示例", path: "/p/b.json" }]);
  });
});
