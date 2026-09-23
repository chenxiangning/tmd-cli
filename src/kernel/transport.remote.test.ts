/**
 * transport 远程模式(移动壳已配对)契约测试;范式与 transport.test.ts 对齐。
 * 被测契约:
 * - configureRemoteEndpoint 后 invoke/listen 走桥,URL 带 ?device=&token=(wsUrl 尾斜杠去)
 * - hello capabilities 经 serverCapabilities 暴露
 * - 4001 = 撤销:onRemoteRevoked 触发、pending 全拒、不再重连
 * - bye pending = 待授权暂态:不闭桥、退避重拨(桌面授权后自动上线)
 * - configureRemoteEndpoint(null) 后 invoke 抛「web bridge closed」,不再连旧端点
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const tauriInvoke = vi.fn();
const tauriListen = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriListen }));

/* ---- 假 WebSocket:与 transport.test.ts 同款最小形状 ---- */
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

let transport: typeof import("./transport");

describe("transport 远程模式(壳已配对)", () => {
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
      wsUrl: "ws://192.168.1.5:61234/",
      deviceId: "dev1",
      token: "tk",
    });
  });

  afterEach(() => {
    transport.configureRemoteEndpoint(null);
  });

  it("invoke 走桥且 URL 携带 device 凭据(wsUrl 尾斜杠已去)", async () => {
    const p = transport.invoke<string>("session_list");
    const ws = lastWS();
    expect(ws.url).toBe("ws://192.168.1.5:61234/ws?device=dev1&token=tk");
    ws.open();
    await vi.advanceTimersByTimeAsync(0); // 冲刷微任务:让 invoke 完成 send/登记 pending
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: [] }));
    await expect(p).resolves.toEqual([]);
  });

  it("hello capabilities 经 serverCapabilities 暴露", async () => {
    const p = transport.serverCapabilities();
    const ws = lastWS();
    ws.open();
    ws.recv(JSON.stringify({ type: "hello", version: "0.3.0", capabilities: ["app-device"] }));
    await expect(p).resolves.toEqual(["app-device"]);
  });

  it("4001 = 撤销:onRemoteRevoked 触发、pending 全拒、不再重连", async () => {
    const onRevoked = vi.fn();
    transport.onRemoteRevoked(onRevoked);
    const p = transport.invoke<string>("session_list");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0); // 冲刷微任务:让 pending 先登记
    ws.onclose?.({ code: 4001 });
    await expect(p).rejects.toThrow("device revoked");
    expect(onRevoked).toHaveBeenCalledOnce();
    // 撤销后等待远超退避窗口:不再建新 socket
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWS.made).toHaveLength(1);
  });

  it("bye 帧 = 带内逐出语义(close code 过不了 relay 中继)", async () => {
    const onRevoked = vi.fn();
    transport.onRemoteRevoked(onRevoked);
    const p = transport.invoke<string>("session_list");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv(JSON.stringify({ type: "bye", reason: "revoked" }));
    await expect(p).rejects.toThrow("device revoked");
    expect(onRevoked).toHaveBeenCalledWith("revoked");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWS.made).toHaveLength(1);
  });

  it("bye pending = 待授权暂态:不闭桥,退避重拨,批准后自动上线", async () => {
    const onRevoked = vi.fn();
    transport.onRemoteRevoked(onRevoked);
    const p = transport.invoke<string>("session_list");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv(JSON.stringify({ type: "bye", reason: "pending" }));
    ws.close(); // 服务器随后关连接(非 4001)
    await expect(p).rejects.toThrow("web bridge disconnected");
    expect(onRevoked).not.toHaveBeenCalled();
    // 退避窗口后重拨(桌面授权前后一直尝试)
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWS.made.length).toBeGreaterThanOrEqual(2);
    // 桌面已授权:新连接 open 后正常应答,invoke 成功(第一次失败占用了 id 1)
    const ws2 = lastWS();
    ws2.open();
    const p2 = transport.invoke<string>("session_list");
    await vi.advanceTimersByTimeAsync(0);
    ws2.recv(JSON.stringify({ type: "response", id: 2, ok: true, payload: ["ok"] }));
    await expect(p2).resolves.toEqual(["ok"]);
  });

  it("configureRemoteEndpoint(null) 后 invoke 直接抛错,不再连旧端点", async () => {
    transport.configureRemoteEndpoint(null);
    await expect(transport.invoke("session_list")).rejects.toThrow("web bridge closed");
    expect(FakeWS.made).toHaveLength(0);
  });

  it("remoteDisconnect = 手动断开:停重拨、invoke 快败;forceRemoteReconnect 恢复", async () => {
    const p = transport.invoke<string>("session_list");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.isRemoteConnected()).toBe(true);
    expect(transport.activeRemoteEndpoint()).toBe("ws://192.168.1.5:61234");
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: [] }));
    await expect(p).resolves.toEqual([]);
    transport.remoteDisconnect();
    expect(transport.isRemoteConnected()).toBe(false);
    expect(transport.isRemotePaused()).toBe(true);
    // 等待远超退避窗口:不再自动重拨
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWS.made).toHaveLength(1);
    await expect(transport.invoke("session_list")).rejects.toThrow("web bridge disconnected");
    // 显式重连:清暂停并立即建连
    transport.forceRemoteReconnect();
    expect(FakeWS.made.length).toBeGreaterThanOrEqual(2);
    expect(transport.isRemotePaused()).toBe(false);
  });
});

