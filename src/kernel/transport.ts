/**
 * 传输层:与 Tauri IPC 同形状的 invoke/listen,浏览器态(无 __TAURI_INTERNALS__)
 * 走 web 访问桥的 WS(协议见 src-tauri/src/web/server.rs)。webview 态原样透传,
 * 前端 868 行 ipc 层对运行环境零感知 —— R3 的「@tauri-apps/* 唯一 import 点」
 * 由此文件继承(ipc.ts 的全部 @tauri 依赖集中到这里)。
 *
 * codemoss transport.ts 移植:重连退避/pending 释放/hello 版本,行为原样保留。
 */

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";

export const isWeb =
  typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window);

/** 桌面端启动 web 访问时铸的 token,随 URL 携带;串行前端态恒 null。 */
export const webToken: string | null = isWeb
  ? new URLSearchParams(window.location.search).get("token")
  : null;

/** 移动壳远程模式凭据:配对成功后由壳写入;置位后 invoke/listen 一律走桥连桌面。 */
export interface RemoteEndpoint {
  /** ws://… 或 wss://…(LAN 直连或 relay worker),不带 /ws 路径。 */
  wsUrl: string;
  deviceId: string;
  token: string;
}

let remoteEndpoint: RemoteEndpoint | null = null;

let revokedCbs: (() => void)[] = [];

/** 壳态切换远程模式;null = 清凭证(撤销/重新配对),桥停连不再重试。 */
export function configureRemoteEndpoint(ep: RemoteEndpoint | null): void {
  remoteEndpoint = ep ? { ...ep, wsUrl: ep.wsUrl.replace(/\/+$/, "") } : null;
  if (remoteEndpoint || bridge) {
    (bridge ??= new WebBridge()).setEndpoint(remoteEndpoint);
  }
}

/** 远程模式(移动壳已配对)判定;与 isWeb(浏览器)互斥的第三态。 */
export function isRemote(): boolean {
  return remoteEndpoint !== null;
}

/** 设备凭据被桌面撤销/拒(WS 4001):壳清凭证回配对屏。返回退订函数。 */
export function onRemoteRevoked(cb: () => void): () => void {
  revokedCbs.push(cb);
  return () => {
    revokedCbs = revokedCbs.filter((f) => f !== cb);
  };
}

type Listener = (payload: unknown) => void;

interface PendingReq {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

const RETRY_MAX_MS = 10_000;

/** WS open 等待上限:过时不等(但保留连接),防服务器无 /ws 时永久挂起。 */
const OPEN_TIMEOUT_MS = 5_000;
class WebBridge {
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
      if (e.code === 4001) {
        /* 桌面撤销/拒绝:停止重连,壳清凭证回配对屏。 */
        this.closed = true;
        for (const entry of this.pending.values()) entry.reject(new Error("device revoked"));
        this.pending.clear();
        for (const cb of revokedCbs.splice(0)) cb();
        return;
      }
      this.onClose(ws);
    };
    ws.onerror = () => {
      // onclose 随后处理重试。
    };
    return promise;
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
    this.openGate = null;
    this.openResolve?.();
    this.openResolve = null;
  }
}

let bridge: WebBridge | null = null;

/** @tauri-apps/api/core invoke 的 drop-in。 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (remoteEndpoint) return (bridge ??= new WebBridge()).invoke<T>(cmd, args);
  if (!isWeb) return tauriInvoke<T>(cmd, args);
  return (bridge ??= new WebBridge()).invoke<T>(cmd, args);
}

/** @tauri-apps/api/event listen 的 drop-in(同 payload 包裹形状)。 */
export function listen<T>(
  name: string,
  cb: (e: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!remoteEndpoint && (!isWeb || typeof window === "undefined")) return tauriListen<T>(name, cb);
  return (bridge ??= new WebBridge()).listen(name, (payload) => cb({ payload: payload as T }));
}

/** 桥 hello 帧上报的服务端版本;不可得为 null。 */
export function serverVersion(): Promise<string | null> {
  if (!isWeb && !remoteEndpoint) return Promise.resolve(null);
  return (bridge ??= new WebBridge()).serverVersion();
}

/** 桥 hello 帧的服务端能力表(协议治理:block 屏据此评估)。 */
export function serverCapabilities(): Promise<string[]> {
  if (!isWeb && !remoteEndpoint) return Promise.resolve([]);
  return (bridge ??= new WebBridge()).serverCapabilities();
}
