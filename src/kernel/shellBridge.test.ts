/**
 * shellBridge 契约测试(transport.test 同款:node 环境 + vi.stubGlobal):
 * - 非壳(无 window / 无 messageHandlers.shell):hasShellBridge=false,invoke reject「unavailable」
 * - 壳:postMessage 帧 {id,method,args};__TMD_SHELL_RESULT__ 回注 resolve/reject
 * - id 配对:迟到旧 id 不影响新请求;未知 id 静默
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Frame = { id: number; method: string; args: unknown };

let bridge: typeof import("./shellBridge");

/** 造壳 window;返回帧收集器与回注入口。 */
function fakeShellWindow() {
  const frames: Frame[] = [];
  const w = {
    webkit: { messageHandlers: { shell: { postMessage: (f: Frame) => frames.push(f) } } },
  };
  vi.stubGlobal("window", w);
  return { w, frames };
}

function result(id: number, ok: boolean, payload: unknown) {
  (window as unknown as { __TMD_SHELL_RESULT__: (id: number, ok: boolean, v: unknown) => void })
    .__TMD_SHELL_RESULT__(id, ok, payload);
}

describe("shellBridge", () => {
  beforeEach(async () => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("非壳环境(node/桌面):hasShellBridge=false,invoke reject 不静默", async () => {
    bridge = await import("./shellBridge");
    expect(bridge.hasShellBridge()).toBe(false);
    await expect(bridge.shellNotify("a", "b")).rejects.toThrow("shell bridge unavailable");
  });

  it("壳环境:notify 帧形状 + 回注 resolve", async () => {
    const { frames } = fakeShellWindow();
    bridge = await import("./shellBridge");
    expect(bridge.hasShellBridge()).toBe(true);
    const p = bridge.shellNotify("等待确认", "omp · 会话 A");
    const f = frames[0];
    expect(f.method).toBe("notify");
    expect(f.args).toEqual({ title: "等待确认", body: "omp · 会话 A" });
    result(f.id, true, null);
    await expect(p).resolves.toBeUndefined();
  });

  it("回注 ok=false → reject 带 error 文案", async () => {
    const { frames } = fakeShellWindow();
    bridge = await import("./shellBridge");
    const p = bridge.shellCreds.get();
    result(frames[0].id, false, "keychain locked");
    await expect(p).rejects.toThrow("keychain locked");
  });

  it("id 错配:旧 id 迟到不影响新请求;未知 id 静默", async () => {
    const { frames } = fakeShellWindow();
    bridge = await import("./shellBridge");
    const p1 = bridge.shellCreds.get();
    const p2 = bridge.shellCreds.set("{}");
    result(frames[1].id, true, undefined);
    await expect(p2).resolves.toBeUndefined();
    result(9999, true, null); // 未知 id 不炸
    result(frames[0].id, true, '{"wsUrl":"x"}');
    await expect(p1).resolves.toBe('{"wsUrl":"x"}');
  });
});
