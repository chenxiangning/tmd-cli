/**
 * 壳能力桥 —— 原生壳(SwiftUI + WKWebView)本机能力的唯一前端入口。
 * 协议:postMessage `{id, method, args}` → Swift ShellBridge 分发 →
 * `window.__TMD_SHELL_RESULT__(id, ok, payload|error)` 回注。
 * 能力:notify(本地通知)/ creds.get/set/delete(iOS 钥匙串)。
 * 非壳环境(桌面/浏览器)hasShellBridge()=false,调用方自行降级;
 * 这些能力是**手机本机**的,不经桌面桥,也不进 AppDevice 白名单。
 */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const pending = new Map<number, Pending>();
let nextId = 1;

interface ShellWindow {
  webkit?: { messageHandlers?: { shell?: { postMessage: (m: unknown) => void } } };
  __TMD_SHELL_RESULT__?: (id: number, ok: boolean, payload: unknown) => void;
}

function shellWindow(): ShellWindow | null {
  if (typeof window === "undefined") return null;
  const w = window as ShellWindow;
  return w.webkit?.messageHandlers?.shell ? w : null;
}

/** 壳桥是否可用(原生壳内为 true;桌面/浏览器 false)。 */
export function hasShellBridge(): boolean {
  return shellWindow() !== null;
}

/** 调壳能力;桥缺席或异常 reject(调用方负责降级,不静默吞)。 */
export function shellInvoke<T = unknown>(method: string, args?: unknown): Promise<T> {
  const w = shellWindow();
  if (!w) return Promise.reject(new Error("shell bridge unavailable"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.webkit!.messageHandlers!.shell!.postMessage({ id, method, args: args ?? null });
  });
}

// ---------- 类型化门面 ----------

/** 本地通知(系统权限被拒时 Swift 侧静默成功,不抛)。 */
export function shellNotify(title: string, body: string): Promise<void> {
  return shellInvoke("notify", { title, body }).then(() => undefined);
}

export interface ShellCredsStore {
  get(): Promise<string | null>;
  set(json: string): Promise<void>;
  delete(): Promise<void>;
}

export const shellCreds: ShellCredsStore = {
  get: () => shellInvoke<string | null>("creds.get"),
  set: (json) => shellInvoke("creds.set", { json }).then(() => undefined),
  delete: () => shellInvoke("creds.delete").then(() => undefined),
};
/* Swift 回注入口:模块加载即注册(幂等覆盖,兼容 HMR 双实例);node 态跳过。 */
if (typeof window !== "undefined") {
  (window as ShellWindow).__TMD_SHELL_RESULT__ = (id, ok, payload) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(payload);
    else p.reject(new Error(String(payload ?? "shell error")));
  };
}
