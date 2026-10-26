/**
 * errText 三原语契约测试:E_ 码前缀剥除/取码。
 * 回归钉:E_GIT2(码含数字,2026-10-26 前字符类 [A-Z_]+ 不匹配致剥码失效);
 * 无码串原样;纯数字后缀码可取。 */
import { describe, expect, it } from "vitest";
import { errTextCode, errTextDisplay, errTextMessage } from "./errText";

describe("errText", () => {
  it("E_GIT2(含数字码)剥码 + 取码", () => {
    expect(errTextDisplay("E_GIT2: connection closed")).toBe("connection closed");
    expect(errTextCode("E_GIT2: connection closed")).toBe("GIT2");
  });

  it("纯字母码照常", () => {
    expect(errTextDisplay(new Error("E_FS_MTIME: 期望态已变"))).toBe("期望态已变");
    expect(errTextCode("E_FS_MTIME: x")).toBe("FS_MTIME");
  });

  it("无码串原样返回/取码 null", () => {
    expect(errTextDisplay("plain failure")).toBe("plain failure");
    expect(errTextCode("plain failure")).toBeNull();
    expect(errTextMessage(new Error("boom"))).toBe("boom");
    expect(errTextMessage("bare")).toBe("bare");
  });

  it("码中数字在中间/开头(数字不可开头)边界", () => {
    expect(errTextCode("E_A2B_C3: x")).toBe("A2B_C3");
    expect(errTextCode("E_2A: x")).toBeNull(); /* 数字开头不是合法码形态,不剥 */
    expect(errTextDisplay("E_2A: x")).toBe("E_2A: x");
  });
});
