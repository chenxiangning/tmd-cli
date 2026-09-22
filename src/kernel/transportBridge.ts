/**
 * WebBridge —— transport 的 WS 桥实现(自 transport.ts 按 300 行铁则拆出)。
 * 协议:JSON 帧 invoke/response/event/hello/bye;4001/bye = 桌面撤销逐出
 * (close code 过不了 relay 中继,bye 是权威语义)。重连退避/pending 释放/hello
 * 版本与能力表,行为与 transport.test/transport.remote.test 契约一致。
 */
import { webToken, type RemoteEndpoint } from "./transport";

/** @tauri-apps/api/event 的 UnlistenFn 真身就是 () => void;本地定义,守 R3 唯一通道。 */
type UnlistenFn = () => void;

type Listener = (payload: unknown) => void;

interface PendingReq {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const RETRY_MAX_MS = 10_000;

/** WS open 等待上限:过时不等(但保留连接),防服务器无 /ws 时永久挂起。 */
const OPEN_TIMEOUT_MS = 5_000;

/* 桥连接态(open/close):RemoteHostBar 与断线重连 UI 消费。 */
let connectedValue = false;
let connCbs: ((v: boolean) => void)[] = [];

function setConnected(v: boolean) {
  if (connectedValue === v) return;
  connectedValue = v;
  for (const cb of connCbs) cb(v);
}

/** 当前桥是否已连(open)。未配对/断开为 false。 */
export function isRemoteConnected(): boolean {
  return connectedValue;
}

/** 订阅桥连接态变化,返回退订。 */
export function onRemoteConnection(cb: (connected: boolean) => void): () => void {
  connCbs.push(cb);
  return () => {
    connCbs = connCbs.filter((f) => f !== cb);
  };
}

/* 设备凭据被桌面撤销/拒的回调表(transport.onRemoteRevoked 再导出)。 */
let revokedCbs: ((reason: string) => void)[] = [];

/** 设备凭据被桌面撤销/拒(WS 4001/bye):壳清凭证回配对屏。回调收 reason
 * ("pending" = 待批准,"rejected" = 已被撤销)。返回退订函数。 */
export function onRemoteRevoked(cb: (reason: string) => void): () => void {
  revokedCbs.push(cb);
  return () => {
    revokedCbs = revokedCbs.filter((f) => f !== cb);
  };
}

export class WebBridge {
  private ws: WebSocket | null = null;
  private openGate: Promise<void> | null = null;
  private openResolve: (() => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();
  private listeners = new Map<string, Set<Listener>>();
  private retryMs = 1000;
  private versionValue: string | null = null;
  private versionWaiters: ((v: string | null) => void)[] = [];
  private endpoint: RemoteEndpoint | null = null;
  /** setEndpoint(null)/4001 后置位:ensure 直接抛错,不再重连。 */
  private closed = false;
  private capsValue: string[] | null = null;
  private capsWaiters: ((v: string[]) => void)[] = [];

  /** 未连则建连;resolve 于 socket open 或 OPEN_TIMEOUT 超时(超时不灭 socket,
   *  真桥迟到时 onopen 仍会 resolve;无 /ws 的环境如 vite dev server,则 invoke
   *  在 readyState 检查处抛「disconnected」而非永久挂起)。 */
  private ensure(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return this.openGate!;
    }
    if (this.closed) throw new Error("web bridge closed");
    const url = this.endpoint
      ? `${this.endpoint.wsUrl}/ws?device=${encodeURIComponent(this.endpoint.deviceId)}&token=${encodeURIComponent(this.endpoint.token)}`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${encodeURIComponent(webToken ?? "")}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.openGate = promise;
    this.openResolve = resolve;
    const openTimer = setTimeout(() => this.openResolve?.(), OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(openTimer);
      this.retryMs = 1000;
      setConnected(true);
      resolve();
    };
    /* 帧可能以二进制回(relay 通道在 Worker 判定帧类型前),String(blob) 会得到
       "[object Blob]" 把响应静默吃掉 —— 统一 arraybuffer + decode。 */
    ws.binaryType = "arraybuffer";
    ws.onmessage = (e) =>
      this.onMessage(
        typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer),
      );
    ws.onclose = (e) => {
      clearTimeout(openTimer);
      setConnected(false);
      if (e.code === 4001) {
        /* 桌面撤销/拒绝:停止重连,壳清凭证回配对屏。 */
        this.closed = true;
        this.releaseRevoked(typeof e.reason === "string" ? e.reason : "");
        return;
      }
      this.onClose(ws);
    };
    ws.onerror = () => {
      // onclose 随后处理重试。
    };
    return promise;
  }

  /** 撤销逐出的统一释放:pending 全拒、hello 等待者对称释放、revoked 回调。 */
  private releaseRevoked(reason: string) {
    for (const entry of this.pending.values()) entry.reject(new Error("device revoked"));
    this.pending.clear();
    /* 等待 hello 的调用方一并释放:4001/bye 下永远不会有 hello。 */
    if (this.versionValue === null) {
      for (const w of this.versionWaiters.splice(0)) w(null);
    }
    if (this.capsValue === null) {
      for (const w of this.capsWaiters.splice(0)) w([]);
    }
    for (const cb of revokedCbs.splice(0)) cb(reason);
  }

  private onMessage(text: string) {
    let msg: {
      type?: string;
      version?: string;
      capabilities?: unknown;
      id?: unknown;
      ok?: boolean;
      payload?: unknown;
      error?: unknown;
      event?: string;
      reason?: unknown;
    };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "hello") {
      this.versionValue = typeof msg.version === "string" ? msg.version : null;
      for (const w of this.versionWaiters.splice(0)) w(this.versionValue);
      this.capsValue = Array.isArray(msg.capabilities)
        ? msg.capabilities.filter((c): c is string => typeof c === "string")
        : [];
      const caps: string[] = this.capsValue;
      for (const w of this.capsWaiters.splice(0)) w(caps);
      return;
    }
    if (msg.type === "response") {
      const id = Number(msg.id);
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (msg.ok) entry.resolve(msg.payload);
      else entry.reject(new Error(String(msg.error ?? "unknown error")));
      return;
    }
    if (msg.type === "event" && typeof msg.event === "string") {
      const subs = this.listeners.get(msg.event);
      if (subs) for (const cb of subs) cb(msg.payload);
      return;
    }
    if (msg.type === "bye") {
      /* 服务端逐出(pending/rejected/revoked)。close code 过不了 relay 中继,
      bye 是权威语义;随后仍会收到 Close,以 this.closed 幂等兜底。 */
      this.closed = true;
      this.releaseRevoked(typeof msg.reason === "string" ? msg.reason : "revoked");
    }
  }

  private onClose(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.openGate = null;
    /* 释放 ensure() 里停住的等待者;invoke 重查 readyState 抛错而非挂起。 */
    this.openResolve?.();
    this.openResolve = null;
    const error = new Error("web bridge disconnected");
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    /* 从未收到 hello(token 错 → 403)也要释放版本等待者,状态栏不卡「…」。 */
    if (this.versionValue === null) {
      for (const w of this.versionWaiters.splice(0)) w(null);
    }
    /* caps 同理对称释放,否则壳 block 屏等 caps 会永久挂起。 */
    if (this.capsValue === null) {
      for (const w of this.capsWaiters.splice(0)) w([]);
    }
    // 桌面可能重启了桥:持续重试。
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    setTimeout(() => void this.ensure(), delay);
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensure();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("web bridge disconnected");
    }
    const id = this.nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    this.ws.send(JSON.stringify({ type: "invoke", id, cmd, args: args ?? {} }));
    return promise;
  }

  async listen(name: string, cb: Listener): Promise<UnlistenFn> {
    void this.ensure();
    let subs = this.listeners.get(name);
    if (!subs) {
      subs = new Set();
      this.listeners.set(name, subs);
    }
    subs.add(cb);
    return () => {
      const set = this.listeners.get(name);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(name);
    };
  }

  serverVersion(): Promise<string | null> {
    if (this.versionValue !== null) return Promise.resolve(this.versionValue);
    const { promise, resolve } = Promise.withResolvers<string | null>();
    this.versionWaiters.push(resolve);
    void this.ensure();
    return promise;
  }

  serverCapabilities(): Promise<string[]> {
    if (this.capsValue !== null) return Promise.resolve(this.capsValue);
    const { promise, resolve } = Promise.withResolvers<string[]>();
    this.capsWaiters.push(resolve);
    void this.ensure();
    return promise;
  }

  /** 远程模式切换(壳配对成功 / 撤销清凭证)。null 且曾连接 → 停连不再重试。 */
  setEndpoint(ep: RemoteEndpoint | null) {
    this.endpoint = ep;
    this.closed = ep === null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null; // 先断关联:onClose 的重试守卫(this.ws !== ws)不再触发
      ws.onclose = null;
      ws.close();
    }
    setConnected(false);
    this.openGate = null;
    this.openResolve?.();
    this.openResolve = null;
  }

  /** 回前台强制重拨(iOS 后台会掐 WS,退避计时器最长 10s 不可等)。 */
  forceReconnect() {
    if (this.closed) return;
    this.retryMs = 1000;
    if (this.ws && this.ws.readyState <= WebSocket.CONNECTING) return; // 已在连
    void this.ensure();
  }
}
