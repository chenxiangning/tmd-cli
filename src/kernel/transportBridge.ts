/**
 * file-size-exempt: 桥状态机核心(退避/轮换/订阅重放/pending 台账单一所有权),二轮评审补强后 332 行;再拆 = 两个文件共享十个私有字段。
 * WebBridge —— transport 的 WS 桥实现(自 transport.ts 按 300 行铁则拆出)。
 * 协议:JSON 帧 invoke/response/event/hello/bye;4001/bye = 桌面撤销逐出
 * (close code 过不了 relay 中继,bye 是权威语义)。重连退避/pending 释放/hello
 * 版本与能力表,行为与 transport.test/transport.remote.test 契约一致。
 */
import { webToken, type RemoteEndpoint } from "./transport";
import { shellLog } from "./shellBridge";
import { createShellWs, shellWsAvailable, WS_CONNECTING, WS_OPEN, type WebSocketLike } from "./shellWs";
import { fireRevoked, setActiveEndpoint, setConnected, setPaused } from "./transportState";
import { DialPolicy } from "./transportDial";

/** @tauri-apps/api/event 的 UnlistenFn 真身就是 () => void;本地定义,守 R3 唯一通道。 */
type UnlistenFn = () => void;

type Listener = (payload: unknown) => void;

interface PendingReq { resolve: (v: unknown) => void; reject: (e: Error) => void; }

/** WS open 等待上限:过时不等(但保留连接),防服务器无 /ws 时永久挂起。 */
const OPEN_TIMEOUT_MS = 5_000;

export class WebBridge {
  private ws: WebSocketLike | null = null;
  private openGate: Promise<void> | null = null;
  private openResolve: (() => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingReq>();
  private listeners = new Map<string, Set<Listener>>();
  private gapCbs = new Set<() => void>();
  private subscribed = new Set<string>();
  /** 拨号策略:退避闸(快败网络下防每 RPC 各自重拨的风暴,真机曾 2 分钟拨
   *  76 万次)+ 候选轮换(连续失败换下一端点)。 */
  private dial = new DialPolicy();
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
    if (this.paused || this.dial.gated()) throw new Error("web bridge disconnected");
    const list = this.candidates();
    const base = list[this.dial.index(list)] ?? null;
    const ep = this.endpoint;
    const url = base && ep
      ? `${base}/ws?device=${encodeURIComponent(ep.deviceId)}&token=${encodeURIComponent(ep.token)}${window.__TMD_DEVICE_NAME__ ? `&name=${encodeURIComponent(window.__TMD_DEVICE_NAME__)}` : ""}`
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
      this.dial.dialed();
      setActiveEndpoint(base);
      setConnected(true);
      /* 订阅重放:新连接必须重放全部在订事件,否则服务端不推。 */
      this.subscribed.clear();
      for (const name of this.listeners.keys()) this.sendSubscribe(name);
      resolve();
    };
    /* 帧可能以二进制回:统一 arraybuffer + decode(String(blob) 静默吃响应)。 */
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
      n?: unknown;
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
    } /* 跳帧信号(二轮 P2-2):消费方重拉重建,幕布不静默缺帧。 */
    else if (msg.type === "event-gap") {
      shellLog(`bridge: event-gap n=${msg.n ?? "?"}`);
      for (const cb of this.gapCbs) cb();
    }
    /* 服务端订阅拒(评审F2):清乐观位,重订可再试 */
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
    if (this.ws !== ws) return; // 已被新 socket 顶替的旧线:无权清场
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
    // 桥可能重启:持续重试(全局闸:退避期内其它 ensure 快败)。
    if (this.paused) return; // 手动断开:停摆,等用户显式重连
    /* 连续失败轮换(二轮 P1-2)与常规退避都归 DialPolicy。 */
    const { delayMs } = this.dial.failed(this.candidates());
    setTimeout(() => { try { void this.ensure(); } catch { /* 退避窗未清/同步快败:由下轮 onClose 接管 */ } }, delayMs);
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    await this.ensure();
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      throw new Error("web bridge disconnected");
    }
    const id = this.nextId++;
    const frame = JSON.stringify({ type: "invoke", id, cmd, args: args ?? {} });
    /* 线帧预算(二轮 P1-3):超限经中继 = 断流+重连循环;带内快败。3.5MiB<4MiB。 */
    if (frame.length > 3_500_000) {
      throw new Error(`请求载荷过大(${Math.round(frame.length / 1024 / 1024)}MB,上限 3.5MB);大文件请在桌面端处理`);
    }
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    this.ws.send(frame);
    return promise;
  }

  /** 事件跳帧通知(服务端 Lagged):幕布消费方重拉 history_page 重建。 */
  onEventGap(cb: () => void): () => void {
    this.gapCbs.add(cb);
    return () => this.gapCbs.delete(cb);
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

  /** 候选端点表(远程态;桌面态空表 → ensure 走浏览器 token 直连分支)。 */
  private candidates(): string[] {
    const ep = this.endpoint;
    if (!ep) return [];
    return (ep.urls?.length ? ep.urls : [ep.wsUrl]).map((u) => u.replace(/\/+$/, ""));
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
    if (ep !== null) this.dial.arm(); /* 换端点=新意图:清退避闸与轮换态(否则 LAN 快败后 relay 探测烧满超时) */
    setPaused(this.paused);
    this.teardownWs();
    setConnected(false);
    this.openGate = null;
    this.openResolve?.();
    this.openResolve = null;
  }

  /** 拆当前 socket(先断关联,onClose 重试守卫不触发;静默 close)。 */
  private teardownWs() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onclose = null;
    ws.close();
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
    this.dial.arm(); // 用户显式重试:绕过退避闸
    /* 卡死拨号(openTimer 超时不灭 socket):拆线重拨,否则黑洞网络下
     * 回前台/手动重试全部 no-op 到壳 60s 超时(二轮 P1-1)。 */
    if (this.ws && this.ws.readyState <= WS_CONNECTING) this.teardownWs();
    void this.ensure();
  }
}
