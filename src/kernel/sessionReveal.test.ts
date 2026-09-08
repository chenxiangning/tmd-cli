/**
 * 会话定位桥契约测试(kernel/sessionReveal.ts)。
 * 覆盖:有 handler 直发 / 无 handler 暂存并注册补派发 / 退订后回到暂存。
 */

import { describe, expect, it, vi } from "vitest";
import {
  registerSessionRevealHandler,
  requestSessionReveal,
} from "./sessionReveal";

describe("sessionReveal", () => {
  it("handler 在位:请求直发", () => {
    const seen: string[] = [];
    const off = registerSessionRevealHandler((id) => seen.push(id));
    requestSessionReveal("a");
    expect(seen).toEqual(["a"]);
    off();
  });

  it("消费端未挂载:请求暂存,注册时补派发一次", () => {
    const seen: string[] = [];
    requestSessionReveal("b"); // 此时无 handler
    const off = registerSessionRevealHandler((id) => seen.push(id));
    expect(seen).toEqual(["b"]); // 注册即补派发,不丢
    requestSessionReveal("c");
    expect(seen).toEqual(["b", "c"]);
    off();
  });

  it("退订后请求回到暂存,新注册方接手", () => {
    const seen: string[] = [];
    const off1 = registerSessionRevealHandler((id) => seen.push(`1:${id}`));
    off1();
    requestSessionReveal("d");
    const off2 = registerSessionRevealHandler((id) => seen.push(`2:${id}`));
    expect(seen).toEqual(["2:d"]);
    off2();
  });

  it("退订不影响在位 handler 的独立生命周期", () => {
    const seen: string[] = [];
    const off = registerSessionRevealHandler(vi.fn());
    off();
    const off2 = registerSessionRevealHandler((id) => seen.push(id));
    requestSessionReveal("e");
    expect(seen).toEqual(["e"]);
    off2();
  });
});
