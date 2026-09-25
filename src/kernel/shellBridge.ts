/**
 * 壳能力桥 —— 原生壳(SwiftUI + WKWebView)本机能力的唯一前端入口。
 * 协议:postMessage `{id, method, args}` → 壳(iOS Swift/Android Kotlin)分发 →
 * `window.__TMD_SHELL_RESULT__(id, ok, payload|error)` 回注。
 * 能力:notify(本地通知)/ creds.get/set/delete(iOS 钥匙串 / Android 加密偏好)。
 * 非壳环境(桌面/浏览器)hasShellBridge()=false,调用方自行降级;
 * 这些能力是**手机本机**的,不经桌面桥,也不进 AppDevice 白名单。
 */

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const pending = new Map<number, Pending>();
let nextId = 1;

interface ShellWindow {
  webkit?: { messageHandlers?: { shell?: { postMessage: (m: unknown) => void } } };
  /** Android 壳:WebView addJavascriptInterface 注入;post 只收 JSON 字符串(接口仅支持原语) */
  AndroidShell?: { post: (json: string) => void };
  __TMD_SHELL_RESULT__?: (id: number, ok: boolean, payload: unknown) => void;
}

function shellWindow(): ShellWindow | null {
  if (typeof window === "undefined") return null;
  const w = window as ShellWindow;
  return w.webkit?.messageHandlers?.shell || w.AndroidShell ? w : null;
}

/** 壳桥是否可用(原生壳内为 true;桌面/浏览器 false)。 */
export function hasShellBridge(): boolean {
  return shellWindow() !== null;
}

/** 壳桥发信封;iOS 走 messageHandlers,Android 走 AndroidShell.post(JSON 串)。 */
function shellPost(m: { id: number; method: string; args: unknown }): void {
  const w = shellWindow();
  if (!w) return;
  if (w.AndroidShell) w.AndroidShell.post(JSON.stringify(m));
  else w.webkit!.messageHandlers!.shell!.postMessage(m);
}

/** 调壳能力;桥缺席或异常 reject(调用方负责降级,不静默吞)。 */
export function shellInvoke<T = unknown>(method: string, args?: unknown): Promise<T> {
  const w = shellWindow();
  if (!w) return Promise.reject(new Error("shell bridge unavailable"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    shellPost({ id, method, args: args ?? null });
  });
}

// ---------- 类型化门面 ----------

/** 页面诊断通道:Swift 侧写入沙箱 Documents/shell.log(发后即忘,无应答方)。 */
export function shellLog(line: string): void {
  shellPost({ id: 0, method: "log", args: { line } });
}

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

/** 壳原生 POST(自签中继的 /pair:WKWebView fetch 过不了自签校验)。
 * pin = 配对 offer 携带的证书 SHA-256 base64(扫码即信任;钥匙串还没有 creds)。 */
export function shellHttpPost(
  url: string,
  body: string,
  pin?: string,
): Promise<{ status: number; body: string }> {
  return shellInvoke("http.post", { url, body, pin });
}
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
