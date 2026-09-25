/**
 * 壳 WS 隧道 —— iOS WKWebView 的自定义 scheme 页面(app://tmd)发不出 ws://
 * (WebKit 限制:fetch 可用、WebSocket 不可用,Tauri iOS 同类问题)。JS 侧把
 * 连接意图经 shell 桥 postMessage 给 Swift,Swift 用 URLSessionWebSocketTask
 * 建连(无 origin 限制),帧回注 window.__TMD_SHELL_WS__(connId, event, payload)。
 * ShellWebSocket 与 transportBridge 实际用到的 WebSocket 子集同构;手机壳自动
 * 走此通道,浏览器/桌面不受影响。
 */

/** 与 WebSocket 常量同构(transportBridge 按 readyState 数值判定)。 */
export const WS_CONNECTING = 0;
export const WS_OPEN = 1;
export const WS_CLOSING = 2;
export const WS_CLOSED = 3;

/** transportBridge 实际使用的 WebSocket 接口子集。 */
export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => unknown) | null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => unknown) | null;
  onclose: ((ev: { code: number; reason: string }) => unknown) | null;
  onerror: ((ev: unknown) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface ShellEvent {
  data?: string;
  b64?: string;
  code?: number;
  reason?: string;
}

type ShellWin = Window & {
  webkit?: {
    messageHandlers?: { shell?: { postMessage(msg: unknown): void } };
  };
  __TMD_SHELL_WS__?: (id: number, event: string, payload: ShellEvent) => void;
};

const conns = new Map<number, ShellWebSocket>();
let nextConn = 1;

function wsPost(msg: unknown): void {
  (window as ShellWin).webkit?.messageHandlers?.shell?.postMessage(msg);
}

/** 壳 WS 隧道是否可用(native shell 才有 webkit.shell 桥)。 */
export function shellWsAvailable(): boolean {
  return typeof (window as ShellWin).webkit?.messageHandlers?.shell?.postMessage === "function";
}

/** 建连:注册回注分发器 + 发 ws.open 意图。open 信号由 Swift ping 往返驱动。 */
export function createShellWs(url: string): WebSocketLike {
  const id = nextConn++;
  const ws = new ShellWebSocket(id);
  conns.set(id, ws);
  const w = window as ShellWin;
  if (!w.__TMD_SHELL_WS__) {
    w.__TMD_SHELL_WS__ = (cid, event, payload) => {
      conns.get(cid)?.onShellEvent(event, payload);
    };
  }
  wsPost({ id: 0, method: "ws.open", args: { id, url } });
  return ws;
}

/** base64(Swift 二进制帧)→ ArrayBuffer(onMessage 的 TextDecoder 路径不变)。 */
function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

class ShellWebSocket implements WebSocketLike {
  readyState: number = WS_CONNECTING;
  onopen: ((ev: unknown) => unknown) | null = null;
  onmessage: ((ev: { data: string | ArrayBuffer }) => unknown) | null = null;
  onclose: ((ev: { code: number; reason: string }) => unknown) | null = null;
  onerror: ((ev: unknown) => unknown) | null = null;

  constructor(private readonly connId: number) {}

  send(data: string): void {
    if (this.readyState !== WS_OPEN) return;
    wsPost({ id: 0, method: "ws.send", args: { id: this.connId, data } });
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState >= WS_CLOSING) return;
    this.readyState = WS_CLOSED;
    conns.delete(this.connId);
    wsPost({ id: 0, method: "ws.close", args: { id: this.connId, code, reason } });
  }

  /** Swift 回注帧(open/message/close);测试可直接驱动。 */
  onShellEvent(event: string, payload: ShellEvent = {}): void {
    if (event === "open") {
      this.readyState = WS_OPEN;
      this.onopen?.(undefined);
      return;
    }
    if (event === "message") {
      if (this.readyState !== WS_OPEN) return;
      const data = payload.b64 !== undefined ? b64ToBuffer(payload.b64) : (payload.data ?? "");
      this.onmessage?.({ data });
      return;
    }
    if (event === "close") {
      if (this.readyState === WS_CLOSED) return; // 本地 close() 已处理
      this.readyState = WS_CLOSED;
      conns.delete(this.connId);
      this.onclose?.({ code: payload.code ?? 1006, reason: payload.reason ?? "" });
    }
  }
}
