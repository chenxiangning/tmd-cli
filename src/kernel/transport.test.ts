/**
 * transport 传输层契约测试。
 * 被测契约清单:
 * - 桌面态(无 window 或有 __TAURI_INTERNALS__):invoke/listen 原样转发 @tauri-apps/api,
 *   参数透传、异常上抛、退订函数转发;serverVersion 恒 null
 * - web 态:invoke 经 WS 发 {type:invoke,id,cmd,args},args 缺省补 {},响应帧按 id 路由,
 *   ok 帧解出 payload、错误帧 reject Error(String(error))
 * - web 态 open 超时(5s)后 invoke 抛「web bridge disconnected」而非永久挂起
 * - web 态连接关闭:所有 pending 请求统一 reject,不悬挂
 * - web 态 listen:事件帧按事件名分发,payload 以 {payload} 包裹;退订后不再收到;
 *   多监听者各收各的
 * - web 态 serverVersion:hello 帧前等待、hello 后取缓存;从未收到 hello(如 403)回落 null
 * - 非法帧(JSON 解析失败)被静默忽略
 *
 * isWeb/webToken 在模块加载时铸定 → beforeEach vi.resetModules + 动态 import,
 * 桌面/web 两态分别搭桩(范式对齐 terminalLinks.test.ts)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const tauriInvoke = vi.fn();
const tauriListen = vi.fn();
/* R3:测试文件不得 import @tauri-apps/*,退订函数用本地最小形状 */
type UnlistenFn = () => void;

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauriListen }));

/* ---- 假 WebSocket:实例全部收进 made,测试驱动 onopen/onmessage/onclose ---- */
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
  /** 服务端回一帧(字符串或二进制) */
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

/* ---------------- 桌面态:转发 @tauri-apps/api ---------------- */
describe("transport 桌面态(无 window,@tauri 转发)", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
    tauriInvoke.mockReset();
    tauriListen.mockReset();
    transport = await import("./transport");
  });

  it("isWeb 为 false、webToken 为 null", () => {
    expect(transport.isWeb).toBe(false);
    expect(transport.webToken).toBeNull();
  });

  it("invoke 转发命令与参数并透传返回值", async () => {
    tauriInvoke.mockResolvedValue({ ok: 1 });
    await expect(transport.invoke("fs_read", { path: "/a", n: 3 })).resolves.toEqual({ ok: 1 });
    expect(tauriInvoke).toHaveBeenCalledWith("fs_read", { path: "/a", n: 3 });
  });

  it("invoke 的 @tauri 异常原样上抛", async () => {
    tauriInvoke.mockRejectedValue(new Error("cmd not found"));
    await expect(transport.invoke("nope")).rejects.toThrow("cmd not found");
  });

  it("listen 转发并以 {payload} 包裹触发回调,退订函数转发", async () => {
    const unlisten: UnlistenFn = vi.fn();
    tauriListen.mockResolvedValue(unlisten);
    const cb = vi.fn();
    const off = await transport.listen<string>("pty://out", cb);
    expect(tauriListen).toHaveBeenCalledWith("pty://out", expect.any(Function));
    // 原样走 @tauri 的 payload 包裹形状
    (tauriListen.mock.calls[0][1] as (e: { payload: string }) => void)({ payload: "hi" });
    expect(cb).toHaveBeenCalledWith({ payload: "hi" });
    off();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("serverVersion 桌面态恒为 null(不经桥)", async () => {
    await expect(transport.serverVersion()).resolves.toBeNull();
  });
});

/* ---------------- web 态:走 WS 桥 ---------------- */
describe("transport web 态(WS 桥)", () => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("isWeb 为 true,webToken 从 URL query 取得", () => {
    expect(transport.isWeb).toBe(true);
    expect(transport.webToken).toBe("abc123");
  });

  it("首条 WS 携带 token 与 /ws 路径;invoke 等 open 后按帧发送 cmd/args,args 缺省补 {}", async () => {
    const p = transport.invoke("fs_read", { path: "/x" });
    const ws = lastWS();
    expect(ws.url).toBe("ws://127.0.0.1:8718/ws?token=abc123");
    expect(ws.sent).toHaveLength(0); // 未 open 不发送
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "invoke", id: 1, cmd: "fs_read", args: { path: "/x" } });
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: "ok" }));
    await expect(p).resolves.toBe("ok");
  });

  it("响应帧按 id 路由:ok 帧解出 payload", async () => {
    const p1 = transport.invoke<string>("a", {});
    const p2 = transport.invoke<number>("b"); // 不传 args
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(ws.sent[1])).toMatchObject({ id: 2, args: {} });
    ws.recv(JSON.stringify({ type: "response", id: 2, ok: true, payload: 7 }));
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: "res-a" }));
    await expect(p1).resolves.toBe("res-a");
    await expect(p2).resolves.toBe(7);
  });

  it("错误帧 reject Error(String(error))", async () => {
    const p = transport.invoke("bad_cmd");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: false, error: "denied" }));
    await expect(p).rejects.toThrow("denied");
  });

  it("open 5s 超时后 invoke 抛「web bridge disconnected」而非永久挂起", async () => {
    const p = transport.invoke("fs_read");
    // 先挂上断言再推时钟,防拒制在挂接前发生被判 unhandled
    const assertion = expect(p).rejects.toThrow("web bridge disconnected");
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(lastWS().sent).toHaveLength(0);
  });

  it("连接关闭:pending 请求统一 reject,不悬挂", async () => {
    const p = transport.invoke("slow_cmd");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.close(); // 未回响应就断开
    await expect(p).rejects.toThrow("web bridge disconnected");
  });

  it("断开后按退避重连(1s→2s),重连成功后新请求走新 socket", async () => {
    const p1 = transport.invoke("first");
    const ws1 = lastWS();
    ws1.open();
    await vi.advanceTimersByTimeAsync(0);
    ws1.close();
    await expect(p1).rejects.toThrow("web bridge disconnected"); // 旧请求已被释放
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWS.made).toHaveLength(1); // 退避未到不重连
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWS.made).toHaveLength(2); // 1s 后重连
    const p2 = transport.invoke("second");
    const ws2 = lastWS();
    expect(ws2).not.toBe(ws1); // 复用重连后的新 socket,不再第三次建连
    expect(FakeWS.made).toHaveLength(2);
    ws2.open();
    await vi.advanceTimersByTimeAsync(0);
    ws2.recv(JSON.stringify({ type: "response", id: 2, ok: true, payload: "ok" }));
    await expect(p2).resolves.toBe("ok");
  });

  it("事件帧按事件名分发、payload 包裹;退订后不再收到;多监听者各收各的", async () => {
    const got1: unknown[] = [];
    const got2: unknown[] = [];
    const off1 = await transport.listen<{ n: number }>("evt://a", (e) => got1.push(e.payload));
    await transport.listen<{ n: number }>("evt://a", (e) => got2.push(e.payload));
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv(JSON.stringify({ type: "event", event: "evt://a", payload: { n: 1 } }));
    expect(got1).toEqual([{ n: 1 }]);
    expect(got2).toEqual([{ n: 1 }]);
    off1();
    ws.recv(JSON.stringify({ type: "event", event: "evt://a", payload: { n: 2 } }));
    expect(got1).toEqual([{ n: 1 }]);
    expect(got2).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("listen 在未连接时也立即返回退订函数(不阻塞在 open 上)", async () => {
    const off = await transport.listen("evt://x", vi.fn());
    expect(typeof off).toBe("function");
    off(); // 退订不抛
  });

  it("serverVersion:hello 帧前等待,hello 后取值;未收到 hello 断开则回落 null", async () => {
    const p = transport.serverVersion();
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv(JSON.stringify({ type: "hello", version: "1.2.3" }));
    await expect(p).resolves.toBe("1.2.3");
    // hello 后再询问走缓存,不依赖连接
    await expect(transport.serverVersion()).resolves.toBe("1.2.3");
  });

  it("从未收到 hello(token 错 403)时 serverVersion 回落 null,状态栏不卡「…」", async () => {
    const p = transport.serverVersion();
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.close();
    await expect(p).resolves.toBeNull();
  });

  it("非 JSON 帧被静默忽略,不影响后续帧处理", async () => {
    const p = transport.invoke<string>("cmd");
    const ws = lastWS();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.recv("not-json{{");
    ws.recv(JSON.stringify({ type: "response", id: 1, ok: true, payload: "ok" }));
    await expect(p).resolves.toBe("ok");
  });
});
