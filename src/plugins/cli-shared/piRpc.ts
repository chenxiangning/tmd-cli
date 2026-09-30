/**
 * pi 族(omp/pi)RPC 客户端 —— `--mode rpc` NDJSON 长驻子进程驱动
 * (kernel proc_stream 通用原语之上;协议知识全插件侧,内核零感知)。
 *
 * spawn:`<command> --mode rpc` NDJSON 长驻子进程,总是新会话。帧:ready/response(按 id
 * 多路复用)、message_start/update/end、tool_execution 三族、session_settled;
 * extension_ui_request
 * method="confirm" = 审批回路(绝不自动批准,答案归 UI)。字段名实证:prompt 用
 * **message**(18.4.4 传 text 报 e.trimStart)。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 */
import { ipc } from "@kernel/ipc";
import type { CliTranscriptBlock } from "@kernel/cli";
import { PiRpcReducer } from "./piRpcReducer";

/** 家族分叉:启动命令(monocode piFlavor 同参照)。 */
export interface PiRpcFlavor {
  command: string;
}

/** 审批请求(extension_ui_request confirm;答案经 respond 回写)。 */
export interface PiRpcConfirm {
  frameId: string;
  title: string;
  message: string;
}

export interface PiRpcHandlers {
  /** 转录块快照(变更即新数组引用)+ 当前轮首块下标(渲染层切「落定历史|流内活轮」)。 */
  onBlocks: (blocks: CliTranscriptBlock[], turnStart: number) => void;
  /** 轮次进行中/结算(session_settled 边沿)。 */
  onBusy: (busy: boolean) => void;
  /** 审批请求;respond 由消费方 UI 调用(confirmId 传入)。 */
  onConfirm: (req: PiRpcConfirm) => void;
  /** 子进程退出(code null = 被杀);此后会话终态。 */
  onExit: (code: number | null) => void;
  /** 协议/连接异常(展示态,不断链)。 */
  onError: (message: string) => void;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class PiRpcSession {
  private id: string | null = null;
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private reducer = new PiRpcReducer();
  private stopListeners: (() => void)[] = [];
  private exited = false;
  private disposed = false;

  constructor(
    private readonly flavor: PiRpcFlavor,
    private readonly cwd: string,
    private readonly handlers: PiRpcHandlers,
  ) {}

  /** spawn 子进程并完成 ready/get_state 握手;返回会话身份(state.data.sessionId)。 */
  async start(): Promise<{ sessionId?: string; model?: string } | null> {
    const id = await ipc.procStreamSpawn({
      command: this.flavor.command,
      args: ["--mode", "rpc"],
      cwd: this.cwd,
    });
    /* spawn await 期间被 kill()(tab 立即关闭等):收割子进程,不订阅不握手。 */
    if (this.disposed) {
      void ipc.procStreamKill(id).catch(() => undefined);
      return null;
    }
    this.id = id;
    this.stopListeners.push(
      await ipc.onProcStream(id, "out", (line) => this.onLine(line)),
      await ipc.onProcStream(id, "err", (line) => this.handlers.onError(String(line))),
      await ipc.onProcStream(id, "exit", (code) => this.onExit(code as number | null)),
    );
    /* 握手:get_state 即就绪探测(ready 帧只是噪声起点,state 到 = 协议活)。 */
    const state = (await this.request({ type: "get_state" })) as Record<string, unknown> | null;
    return state
      ? { sessionId: typeof state.sessionId === "string" ? state.sessionId : undefined,
          model: typeof state.model === "object" && state.model
            ? String((state.model as Record<string, unknown>).id ?? "") || undefined
            : undefined }
      : null;
  }

  /** 发一轮 prompt(字段 message,实证;text 会被 18.4.4 拒)。 */
  async send(text: string): Promise<void> {
    await this.request({ type: "prompt", message: text });
  }

  /** 中止在途轮。 */
  async abort(): Promise<void> {
    await this.request({ type: "abort" }).catch(() => undefined);
  }

  /** 审批应答;confirmId 即 onConfirm 回传 frameId。 */
  respond(confirmId: string, confirmed: boolean): void {
    void this.raw({
      type: "extension_ui_response",
      id: confirmId,
      ...(confirmed ? { confirmed: true } : { cancelled: true }),
    });
  }

  /** 杀子进程(tab 关闭/会话终结);幂等。 */
  kill(): void {
    this.disposed = true;
    if (this.id && !this.exited) ipc.procStreamKill(this.id).catch(() => undefined);
    this.teardown();
  }

  private onExit(code: number | null) {
    if (this.exited) return;
    this.teardown();
    this.handlers.onExit(code);
  }

  private teardown() {
    for (const stop of this.stopListeners) stop();
    this.stopListeners = [];
    for (const p of this.pending.values()) p.reject(new Error("rpc 进程已退出"));
    this.pending.clear();
  }

  private onLine(payload: unknown) {
    const line = String(payload);
    if (!line.startsWith("{")) return;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return; // 半行/非 JSON(理论上 proc_stream 按行切,防御)
    }
    switch (rec.type) {
      case "response": {
        if (typeof rec.id === "string") {
          const p = this.pending.get(rec.id);
          if (p) {
            this.pending.delete(rec.id);
            if (rec.success === true) p.resolve(rec.data);
            else p.reject(new Error(String(rec.error ?? "rpc 响应失败")));
          }
        }
        return;
      }
      case "session_start":
      case "message_start":
      case "message_update":
      case "message_end":
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        this.handlers.onBlocks(this.reducer.feed(rec), this.reducer.turnStart);
        return;
      case "session_settled":
        this.handlers.onBlocks(this.reducer.feed(rec), this.reducer.turnStart);
        this.handlers.onBusy(false);
        return;
      case "agent_start":
        this.handlers.onBusy(true);
        return;
      case "extension_ui_request": {
        if (rec.method === "confirm") {
          this.handlers.onConfirm({
            frameId: String(rec.id ?? ""),
            title: String(rec.title ?? ""),
            message: String(rec.message ?? ""),
          });
        } else {
          /* select/input/editor 等 TUI 部件:取消以免挂轮(monocode 同律)。 */
          if (rec.id) void this.raw({ type: "extension_ui_response", id: String(rec.id), cancelled: true });
        }
        return;
      }
      default:
        return; // ready / extension 噪声 / available_commands / prompt_result 等
    }
  }

  /** 带超时的请求多路复用;进程退出统一 reject。 */
  private request(cmd: Record<string, unknown>): Promise<unknown> {
    const id = `tmd-${++this.seq}`;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error("rpc 请求超时"));
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    void this.raw({ ...cmd, id }).catch((e: unknown) => {
      this.pending.delete(id);
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
    return promise;
  }

  private async raw(cmd: Record<string, unknown>): Promise<void> {
    if (!this.id || this.exited) throw new Error("rpc 会话已结束");
    await ipc.procStreamWrite(this.id, JSON.stringify(cmd) + "\n");
  }
}
