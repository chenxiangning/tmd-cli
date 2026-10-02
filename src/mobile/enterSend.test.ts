import { describe, expect, it } from "vitest";
import { mobileEnterAction } from "./enterSend";

const base = { shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false };

describe("mobileEnterAction(手机 Enter 语义)", () => {
  it("裸 Enter = 换行(软键盘无 Shift,平台惯例)", () => {
    expect(mobileEnterAction(base)).toBe("newline");
  });

  it("⌘/Ctrl+Enter = 发送(硬件键盘兜底)", () => {
    expect(mobileEnterAction({ ...base, metaKey: true })).toBe("send");
    expect(mobileEnterAction({ ...base, ctrlKey: true })).toBe("send");
  });

  it("IME 组合中一律不拦截(选词回车不误发)", () => {
    expect(mobileEnterAction({ ...base, isComposing: true, metaKey: true })).toBe("newline");
  });

  it("keyCode 229 兜底(WKWebView 组合末尾确认 Enter)", () => {
    expect(mobileEnterAction({ ...base, keyCode: 229, metaKey: true })).toBe("newline");
  });
});
