/**
 * 桥 invoke 响应超时契约(自 transport.remote.test 拆出,300 行铁则):
 * - 半开线(socket open 而后端已死)响应永不回 → 15s reject "bridge response timeout";
 * - 超时即强断病线,交给 onClose/DialPolicy 重拨(REDIAL_DELAY_MS=1s);
 * - 迟到响应打在已删 pending entry 上:静默丢弃,不炸不重放。
 * 2026-10-03 外网「重连中」横幅高频复现根因:轮询 pull 永挂 → 流量停摆 → 中继 idle 掐线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as TransportNS from "./transport";
const tauriInvoke = vi.fn();
const tauriListen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriListen }));

/* ---- 假 WebSocket:与 transport.remote.test.ts 同款最小形状 ---- */
class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static made: FakeWS[] = [];
  url: string;
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWS.made.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  recv(text: string) {
    this.onmessage?.({ data: text });
  }
}

function lastWS(): FakeWS {
  const ws = FakeWS.made[FakeWS.made.length - 1];
  if (!ws) throw new Error("没有可用的 FakeWS 实例");
  return ws;
}

/* 动态 import 刻意:vi.resetModules() 后须取全新模块实例(范式同 transport.remote.test) */
let transport: typeof TransportNS;

describe("桥 invoke 响应超时(半开自愈)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeWS.made = [];
    vi.stubGlobal("WebSocket", FakeWS);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "127.0.0.1:8718", search: "?token=abc123" },
    });
    vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8718" });
    transport = await import("./transport");
    transport.configureRemoteEndpoint({
      wsUrl: "ws://192.168.1.5:61234",
      deviceId: "dev1",
      token: "tk",
    });
  });

  afterEach(() => {
    transport.configureRemoteEndpoint(null);
  });

  it("15s reject 并强断病线,DialPolicy 接管重拨", async () => {
    const p = transport.invoke<string>("session_list");
    const ws1 = lastWS();
    ws1.open();
    await vi.advanceTimersByTimeAsync(0);
    /* 断言先挂再推进:rej 瞬间无 handler 会成 unhandled */
    const verdict = expect(p).rejects.toThrow("bridge response timeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await verdict;
    expect(ws1.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(1000); // REDIAL_DELAY_MS=1s
    expect(FakeWS.made.length).toBeGreaterThanOrEqual(2);
    /* 迟到响应:已删 entry 静默丢弃 */
    ws1.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: ["late"] }));
  });
});
