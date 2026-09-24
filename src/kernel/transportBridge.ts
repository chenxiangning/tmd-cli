/**
 * WebBridge —— transport 的 WS 桥实现(自 transport.ts 按 300 行铁则拆出)。
 * 协议:JSON 帧 invoke/response/event/hello/bye;4001/bye = 桌面撤销逐出
 * (close code 过不了 relay 中继,bye 是权威语义)。重连退避/pending 释放/hello
 * 版本与能力表,行为与 transport.test/transport.remote.test 契约一致。
 */
import { webToken, type RemoteEndpoint } from "./transport";
import { shellLog } from "./shellBridge";
import { createShellWs, shellWsAvailable, WS_CONNECTING, WS_OPEN, type WebSocketLike } from "./shellWs";
import { fireRevoked, setActiveEndpoint, setConnected, setPaused } from "./transportState";

/** @tauri-apps/api/event 的 UnlistenFn 真身就是 () => void;本地定义,守 R3 唯一通道。 */
type UnlistenFn = () => void;

type Listener = (payload: unknown) => void;

interface PendingReq { resolve: (v: unknown) => void; reject: (e: Error) => void; }

const RETRY_MAX_MS = 10_000;
/** WS open 等待上限:过时不等(但保留连接),防服务器无 /ws 时永久挂起。 */
const OPEN_TIMEOUT_MS = 5_000;

export class WebBridge {
  private ws: WebSocketLike | null = null;
  private openGate: Promise<void> | null = null;
  private openResolve: (() => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();
  private listeners = new Map<string, Set<Listener>>();
  /** 本连接已订阅的事件名(新连接 open 时按 listeners 重放)。 */
  private subscribed = new Set<string>();
  private retryMs = 1000;
  /** 全局重拨闸:onClose 起算的退避期内,一切 ensure() 直接失败,不再新建 socket
   *  (否则每个轮询 RPC 各自重拨,快败网络下秒级风暴——真机曾 2 分钟拨 76 万次)。 */
  private nextDialAt = 0;
  private versionValue: string | null = null;
  private versionWaiters: ((v: string | null) => void)[] = [];
  private endpoint: RemoteEndpoint | null = null;
  /** setEndpoint(null)/4001 后置位:ensure 直接抛错,不再重连。 */
  private closed = false;
  private capsValue: string[] | null = null;
  private capsWaiters: ((v: string[]) => void)[] = [];
  /** 手动断开置位(手机连接面板):ensure 快败,onClose 不再排重拨。 */
  private paused = false;

  /** 未连则建连;resolve 于 socket open 或 OPEN_TIMEOUT 超时(超时不灭 socket,
   *  真桥迟到时 onopen 仍会 resolve;无 /ws 的环境如 vite dev server,则 invoke
   *  在 readyState 检查处抛「disconnected」而非永久挂起)。 */
  private ensure(): Promise<void> {
    if (
      this.ws &&
      (this.ws.readyState === WS_OPEN || this.ws.readyState === WS_CONNECTING)
    ) {
      return this.openGate!;
    }
    if (this.closed) throw new Error("web bridge closed");
    if (this.paused || Date.now() < this.nextDialAt) throw new Error("web bridge disconnected");
    const url = this.endpoint
      ? `${this.endpoint.wsUrl}/ws?device=${encodeURIComponent(this.endpoint.deviceId)}&token=${encodeURIComponent(this.endpoint.token)}${window.__TMD_DEVICE_NAME__ ? `&name=${encodeURIComponent(window.__TMD_DEVICE_NAME__)}` : ""}`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?token=${encodeURIComponent(webToken ?? "")}`;
    const ws: WebSocketLike = shellWsAvailable()
      ? createShellWs(url)
      : new WebSocket(url) as unknown as WebSocketLike; // 原生 WS 满足所用子集;handler 签名(this,ev)在 strictFunctionTypes 下不可结构化收窄
    this.ws = ws;
    const { promise, resolve } = Promise.withResolvers<void>();
    this.openGate = promise;
    this.openResolve = resolve;
    const openTimer = setTimeout(() => this.openResolve?.(), OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(openTimer);
      this.retryMs = 1000;
      this.nextDialAt = 0;
      setActiveEndpoint(this.endpoint?.wsUrl ?? null);
      setConnected(true);
      /* 事件订阅闸:新连接重放全部在订事件,否则服务端不再推 event。 */
      this.subscribed.clear();
      for (const name of this.listeners.keys()) this.sendSubscribe(name);
      resolve();
    };
    /* 帧可能以二进制回(relay 通道在 Worker 判定帧类型前),String(blob) 会得到
       "[object Blob]" 把响应静默吃掉 —— 统一 arraybuffer + decode。 */
    if (ws instanceof WebSocket) ws.binaryType = "arraybuffer";
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
    /* 回调不清空:常驻订阅者(壳撤销回配对屏)须跨多次逐出存活;
     * bye+4001close 双触发由消费方幂等兜底。 */
    fireRevoked(reason);
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
    } /* 服务端订阅拒(评审F2):清乐观位,重订可再试 */
    else if (msg.type === "subscribe-rejected") this.subscribed.delete(String(msg.event));
    if (msg.type === "bye") {
      const reason = typeof msg.reason === "string" ? msg.reason : "revoked";
      shellLog(`bridge: bye reason=${reason}`);
      // pending=待授权暂态:不闭桥,退避重拨,授权后 ≤10s 自动上线;其余=逐出(bye 权威语义)
      if (reason !== "pending") {
        this.closed = true;
        this.releaseRevoked(reason);
        return;
      }
    }
  }

  private onClose(ws: WebSocketLike) {
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
    // 桌面可能重启了桥:持续重试(全局闸:退避期内其它 ensure 一律快败)。
    if (this.paused) return; // 手动断开:停摆,等用户显式重连
    this.nextDialAt = Date.now() + this.retryMs;
    const delay = this.retryMs; this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    setTimeout(() => { try { void this.ensure(); } catch { /* 退避窗未清:由下轮 onClose 重排 */ } }, delay);
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensure();
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
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
    try { void this.ensure(); } catch { /* 退避/paused 快败:注册照常,open 时统一重放(评审:同步抛会断实况订阅) */ }
    let subs = this.listeners.get(name);
    if (!subs) {
      subs = new Set();
      this.listeners.set(name, subs);
      this.sendSubscribe(name);
    }
    subs.add(cb);
    return () => {
      const set = this.listeners.get(name);
      if (!set) return;
      set.delete(cb);
      if (set.size === 0) {
        this.listeners.delete(name);
        if (this.subscribed.delete(name) && this.ws?.readyState === WS_OPEN) {
          this.ws.send(JSON.stringify({ type: "unsubscribe", event: name }));
        }
      }
    };
  }

  private sendSubscribe(name: string) {
    if (this.subscribed.has(name) || this.ws?.readyState !== WS_OPEN) return;
    this.subscribed.add(name);
    this.ws.send(JSON.stringify({ type: "subscribe", event: name }));
  }

  serverVersion(): Promise<string | null> {
    if (this.versionValue !== null) return Promise.resolve(this.versionValue);
    if (this.closed) return Promise.resolve(null); /* closed 早返:不注册永不收敛的 waiter(评审 P2) */
    const { promise, resolve } = Promise.withResolvers<string | null>();
    this.versionWaiters.push(resolve);
    void this.ensure();
    return promise;
  }
  serverCapabilities(): Promise<string[]> {
    if (this.capsValue !== null) return Promise.resolve(this.capsValue);
    if (this.closed) return Promise.resolve([]); /* 同 version:closed 不吊 waiter */
    const { promise, resolve } = Promise.withResolvers<string[]>();
    this.capsWaiters.push(resolve);
    void this.ensure();
    return promise;
  }
  /** 远程模式切换(壳配对成功 / 撤销清凭证)。null 且曾连接 → 停连不再重试。 */
  setEndpoint(ep: RemoteEndpoint | null) {
    this.endpoint = ep;
    this.closed = ep === null; this.versionValue = null; this.capsValue = null; /* 换端点=新桌面:停连 + hello 缓存失效(评审:旧 caps 旁路 block 防线) */
    this.paused = ep === null; // 换端点 = 重新开始;清凭证则一并停摆
    if (ep !== null) { this.retryMs = 1000; this.nextDialAt = 0; } /* 换端点=新意图:旧端点的退避闸不得劫持新端点首连(否则 LAN 快败后 relay 探测烧满超时) */
    setPaused(this.paused);
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

  /** 手动断开(手机连接面板):立即关连接并停止一切自动重拨。 */
  disconnect() {
    if (this.closed) return;
    this.paused = true;
    setPaused(true);
    if (this.ws) {
      const ws = this.ws;
      ws.onclose = null; // 不走自动重拨路径
      ws.close();
      this.onClose(ws); // 统一拆摊:拒 pending/放等待者(paused 守卫下不再排重拨)
    }
    setConnected(false);
  }

  /** 回前台强制重拨(iOS 后台会掐 WS,退避计时器最长 10s 不可等);同时清手动断开。 */
  forceReconnect() {
    if (this.closed) return;
    this.paused = false;
    setPaused(false);
    this.retryMs = 1000;
    this.nextDialAt = 0; // 用户显式重试:绕过退避闸
    if (this.ws && this.ws.readyState <= WS_CONNECTING) return; // 已在连
    void this.ensure();
  }
}
