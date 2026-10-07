/**
 * composerExt 空发送放行契约测试 —— 注册面为新增性能,此处只锁行为:
 * 无注册恒拦(默认语义不变);注册后按 sessionId 放行;注销回收。
 */
import { describe, expect, it } from "vitest";
import { composerEmptySendPermitted, registerComposerEmptySendProvider } from "./composerExt";

describe("composerEmptySendProvider", () => {
  it("无注册 = 空输入恒拦(既有语义不动)", () => {
    expect(composerEmptySendPermitted("pty-1")).toBe(false);
    expect(composerEmptySendPermitted(null)).toBe(false);
  });

  it("注册后按 sessionId 放行,任一 provider 命中即放行", () => {
    const off = registerComposerEmptySendProvider((sid) => sid === "pty-1");
    expect(composerEmptySendPermitted("pty-1")).toBe(true);
    expect(composerEmptySendPermitted("pty-2")).toBe(false);
    off();
    expect(composerEmptySendPermitted("pty-1")).toBe(false);
  });

  it("多 provider 并存:任一 true 即 true;全部注销回默认", () => {
    const offA = registerComposerEmptySendProvider(() => false);
    const offB = registerComposerEmptySendProvider((sid) => sid === "pty-9");
    expect(composerEmptySendPermitted("pty-9")).toBe(true);
    expect(composerEmptySendPermitted("pty-1")).toBe(false);
    offB();
    expect(composerEmptySendPermitted("pty-9")).toBe(false);
    offA();
  });
});
