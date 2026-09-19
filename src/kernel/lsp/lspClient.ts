/**
 * LSP 连接管理 + JSON-RPC 薄层 —— 请求 id 关联/超时/取消 + server→client
 * 请求最低限应答。Rust(lsp.rs)只做字节↔消息边界;本层不知道任何语言,
 * 文档同步(didOpen/didChange)由插件胶水经 notify 驱动。
 *
 * 超时语义:hover/definition 默认 5s,references 10s,initialize 60s
 * (jdt.ls 冷启动);超时即发 $/cancelRequest 并 reject,server 应答照收但丢弃。
 */

import { lspSend, lspSpawn, lspStop, onLspExit, onLspMessage } from "../ipc";

export interface LspConnection {
  readonly key: string;
  readonly capabilities: Record<string, unknown>;
  request<T = unknown>(method: string, params: unknown, timeoutMs?: number): Promise<T>;
  notify(method: string, params: unknown): void;
}

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: LspTimerHandle;
}

type LspTimerHandle = ReturnType<typeof setTimeout>;

interface ConnectionBox {
  conn: LspConnection | null;
  /** 同 key 并发 open 共享一个在途 promise。 */
  opening: Promise<LspConnection> | null;
  pending: Map<number, PendingEntry>;
}

const boxes = new Map<string, ConnectionBox>();
let listenersBound = false;

function box(key: string): ConnectionBox {
  let b = boxes.get(key);
  if (!b) {
    b = { conn: null, opening: null, pending: new Map() };
    boxes.set(key, b);
  }
  return b;
}

/** server→client 请求的最低限应答:不回应会让 pyright/jdt 初始化卡死。 */
function answerServerRequest(key: string, msg: Record<string, unknown>) {
  let result: unknown = null;
  if (msg.method === "workspace/configuration") {
    const params = msg.params;
    const count =
      typeof params === "object" &&
      params !== null &&
      "items" in params &&
      Array.isArray(params.items)
        ? params.items.length
        : 1;
    result = Array.from({ length: count }, () => null);
  }
  void rawSend(key, { jsonrpc: "2.0", id: msg.id, result });
}

function routeMessage(key: string, payload: string) {
  const b = boxes.get(key);
  if (!b) return;
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return; // 坏 JSON 丢弃(防御;Rust 侧已保证帧完整)
  }
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const entry = b.pending.get(msg.id as number);
    if (!entry) return;
    clearTimeout(entry.timer);
    b.pending.delete(msg.id as number);
    const err = msg.error;
    if (err !== undefined) {
      const message =
        typeof err === "object" && err !== null && "message" in err && typeof err.message === "string"
          ? err.message
          : "LSP error";
      entry.reject(new Error(message));
    } else {
      entry.resolve(msg.result);
    }
  } else if (msg.id !== undefined) {
    answerServerRequest(key, msg);
  } else {
    /* 纯通知(无 id):暂无消费面(诊断等后续特性接入点),静默丢弃。 */
  }
}

function failAllPending(key: string, reason: string) {
  const b = boxes.get(key);
  if (!b) return;
  for (const entry of b.pending.values()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
  b.pending.clear();
}

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;
  onLspMessage((e) => routeMessage(e.key, e.payload));
  onLspExit((e) => {
    /* 进程退出即清连接态(state→none),否则死 conn 残留"ready",手势永不重建。 */
    const b = boxes.get(e.key);
    if (b) {
      b.conn = null;
      b.opening = null;
    }
    failAllPending(e.key, `语言服务进程退出(code=${e.code ?? "?"})`);
  });
}

function rawSend(key: string, message: unknown): Promise<void> {
  return lspSend(key, JSON.stringify(message));
}

export interface OpenLspOptions {
  key: string;
  rootUri: string;
  /** spawn 描述(发现链产物)。 */
  launch: { command: string; args: readonly string[]; env?: Record<string, string> };
  cwd: string;
  initializationOptions?: unknown;
  /** initialize 超时(缺省 60s,jdt 冷启预留)。 */
  initTimeoutMs?: number;
}

/** 打开(或复用)一条连接:spawn → initialize → initialized。 */
export async function openLspConnection(opts: OpenLspOptions): Promise<LspConnection> {
  ensureListeners();
  const b = box(opts.key);
  if (b.conn) return b.conn;
  if (b.opening) return b.opening;

  b.opening = (async () => {
    await lspSpawn(opts.key, opts.launch.command, opts.launch.args, opts.cwd, opts.launch.env);
    let nextId = 1;
    const request = <T>(method: string, params: unknown, timeoutMs = 5000) => {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const entry: PendingEntry = {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer: setTimeout(() => {
            b.pending.delete(id);
            void rawSend(opts.key, { jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
            reject(new Error(`LSP ${method} 超时`));
          }, timeoutMs),
        };
        b.pending.set(id, entry);
        void rawSend(opts.key, { jsonrpc: "2.0", id, method, params }).catch(reject);
      });
    };
    let capabilities: Record<string, unknown> = {};
    try {
      const init = await request<{ capabilities?: Record<string, unknown> }>(
        "initialize",
        {
          processId: null,
          rootUri: opts.rootUri,
          capabilities: {},
          workspaceFolders: [{ uri: opts.rootUri, name: opts.rootUri.replace(/^file:\/\//, "") }],
          initializationOptions: opts.initializationOptions,
        },
        opts.initTimeoutMs ?? 60_000,
      );
      capabilities = init.capabilities ?? {};
    } catch (err) {
      await lspStop(opts.key).catch(() => {});
      throw err;
    }
    const conn: LspConnection = {
      key: opts.key,
      capabilities,
      request,
      notify: (method, params) => {
        void rawSend(opts.key, { jsonrpc: "2.0", method, params }).catch(() => {});
      },
    };
    conn.notify("initialized", {});
    b.conn = conn;
    return conn;
  })();

  try {
    return await b.opening;
  } finally {
    b.opening = null;
  }
}

/** 连接状态(键不存在 = none)。 */
export function lspConnectionState(key: string): "opening" | "ready" | "none" {
  const b = boxes.get(key);
  if (!b) return "none";
  if (b.conn) return "ready";
  return b.opening ? "opening" : "none";
}

/** 优雅关停:shutdown request(LSP 规范,非 notification)→ exit 通知 → 杀树。 */
export async function closeLspConnection(key: string): Promise<void> {
  const b = boxes.get(key);
  if (!b) {
    await lspStop(key).catch(() => {});
    return;
  }
  const conn = b.conn;
  b.conn = null;
  b.opening = null;
  if (conn) {
    await conn.request("shutdown", null, 2000).catch(() => {});
    conn.notify("exit", null);
  }
  failAllPending(key, "连接已关闭");
  await lspStop(key).catch(() => {});
}
