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
 * cli-shared 准入先例:cli-omp/cli-pi 的 structuredRpc 声明 + structured-session
 * 插件(feature)联合消费(1 cli-* + feature 形态)。
 */
import { ipc } from "@kernel/ipc";
import type { CliTranscriptBlock } from "@kernel/cli";
import { PiRpcReducer, clockOf, widgetCancelledNotice, widgetTier } from "./piRpcReducer";

import { parseState, type PiRpcCommand, type PiRpcConfirm, type PiRpcFlavor, type PiRpcModel, type PiRpcState, type PiRpcStats } from "./piRpcTypes";

export type { PiRpcFlavor, PiRpcModel, PiRpcState, PiRpcConfirm, PiRpcStats, PiRpcCommand } from "./piRpcTypes";

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
/** prompt 超时:18.6 抓包实证应答为即时 ack(非轮末),与通用闸同值即可。 */
const PROMPT_TIMEOUT_MS = 30_000;


/** 部件帧 id 归一:字符串原样、有限数字转字符串(JSON-RPC id 按协议可为数字,
 * confirm 路同律;2026-10-03 范围评审实锤:字符串守卫会把数值 id 帧静默丢弃,
 * 无应答可挂轮),其余返空 = 真畸形,不产。 */
function normWidgetFrameId(v: unknown): string {
  if (typeof v === "string" && v) return v;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

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
    private readonly opts?: { resume?: string; seedBlocks?: CliTranscriptBlock[] },
  ) {
    if (opts?.seedBlocks) this.reducer.seed(opts.seedBlocks);
  }

  /** spawn 子进程并完成 ready/get_state 握手;返回会话身份(parseState 同源)。 */
  async start(): Promise<PiRpcState | null> {
    const id = await ipc.procStreamSpawn({
      command: this.flavor.command,
      args: ["--mode", "rpc", ...(this.opts?.resume && this.flavor.resumeArgs ? this.flavor.resumeArgs(this.opts.resume) : [])],
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
    return this.getState();
  }

  /** get_state 轻量刷新(set_model/set_thinking_level 后回读权威态)。 */
  async getState(): Promise<PiRpcState | null> {
    const d = (await this.request({ type: "get_state" })) as Record<string, unknown> | null;
    return d ? parseState(d) : null;
  }

  /** 发一轮 prompt(字段 message,实证;text 会被 18.4.4 拒);超时走 prompt 专用闸。 */
  async send(text: string): Promise<void> {
    await this.request({ type: "prompt", message: text }, PROMPT_TIMEOUT_MS);
  }

  /** 轮次进行中排队下一条(follow_up;引擎结算后自动起跑,参数 message 与 prompt 同形,18.6 实证)。 */
  async followUp(text: string): Promise<void> {
    await this.request({ type: "follow_up", message: text }, PROMPT_TIMEOUT_MS);
  }

  /** 中止在途轮。 */
  async abort(): Promise<void> {
    await this.request({ type: "abort" }).catch(() => undefined);
  }

  /* 模型/思考级(18.6 抓包实证:get_available_models→{models},set_model
   * {provider,modelId} 会话级切换不落 CLI 配置,失败 reject(如
   * "Model not found: p/m");get_available_thinking_levels→{levels},
   * set_thinking_level {level})。清单失败回空表,UI 收空表不开菜单。 */
  async getAvailableModels(): Promise<PiRpcModel[]> {
    const d = (await this.request({ type: "get_available_models" }).catch(() => null)) as { models?: unknown } | null;
    return Array.isArray(d?.models) ? (d.models as PiRpcModel[]) : [];
  }

  setModel(provider: string, modelId: string): Promise<unknown> {
    return this.request({ type: "set_model", provider, modelId });
  }

  async getThinkingLevels(): Promise<string[]> {
    const d = (await this.request({ type: "get_available_thinking_levels" }).catch(() => null)) as { levels?: unknown } | null;
    return Array.isArray(d?.levels) ? (d.levels as string[]) : [];
  }

  setThinkingLevel(level: string): Promise<unknown> {
    return this.request({ type: "set_thinking_level", level });
  }

  /* 用量与命令目录(get_session_stats → tokens.total + contextUsage.percent;
   * get_available_commands → {commands:[{name,description,input?.hint}]},97 条实证)。
   * 失败回空态:stats=null 不显示,commands=[] 不开补全。 */
  async getStats(): Promise<PiRpcStats | null> {
    const d = await this.request({ type: "get_session_stats" }).catch(() => null) as Record<string, unknown> | null;
    if (!d) return null;
    const tokens = d.tokens as Record<string, unknown> | undefined;
    const ctx = d.contextUsage as Record<string, unknown> | undefined;
    return {
      totalTokens: typeof tokens?.total === "number" ? tokens.total : undefined,
      contextPercent: typeof ctx?.percent === "number" ? ctx.percent : undefined,
    };
  }

  async getCommands(): Promise<PiRpcCommand[]> {
    const d = await this.request({ type: "get_available_commands" }).catch(() => null) as Record<string, unknown> | null;
    const list = d?.commands;
    if (!Array.isArray(list)) return [];
    return list.flatMap((raw) => {
      const c = raw as Record<string, unknown>;
      if (typeof c?.name !== "string") return [];
      const input = c.input as Record<string, unknown> | undefined;
      return [{
        name: c.name,
        description: typeof c.description === "string" ? c.description : undefined,
        hint: typeof input?.hint === "string" ? input.hint : undefined,
      }];
    });
  }

  /** 审批应答;confirmId 即 onConfirm 回传 frameId(同型回写)。进程已退时静默丢弃(UI 已终态)。 */
  respond(confirmId: string | number, confirmed: boolean): void {
    void this.raw({
      type: "extension_ui_response",
      id: confirmId,
      ...(confirmed ? { confirmed: true } : { cancelled: true }),
    }).catch(() => undefined);
  }

  /** 杀子进程(tab 关闭/会话终结);幂等。 */
  kill(): void {
    this.disposed = true;
    if (this.id && !this.exited) ipc.procStreamKill(this.id).catch(() => undefined);
    this.teardown();
  }

  private onExit(code: number | null) {
    if (this.exited) return;
    this.exited = true;
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
      case "turn_start":
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
          /* 畸形帧(缺 id / null / 异型)不产卡:应答 id 无从被引擎认领,产了
           * 就是永不生效的审批卡(与 widget 路 !fid 同律,2026-10-04 复审)。 */
          const cid = typeof rec.id === "number" ? rec.id : typeof rec.id === "string" && rec.id ? rec.id : null;
          if (cid === null) return;
          this.handlers.onConfirm({
            /* 数值 id 原样(同型回传,见 PiRpcConfirm 注释)。 */
            frameId: cid,
            title: String(rec.title ?? ""),
            message: String(rec.message ?? ""),
          });
          return;
        }
        /* select/input/editor 等部件:取消以免挂轮(monocode 同律),协议应答
         * 两档照发,只改展示面——chrome 装饰类聚合一处,真交互与未知 kind
         * 逐条 notice(不再无声替答);id 经 normWidgetFrameId 归一(数值 id
         * 不再被静默丢弃),缺 id/method 的畸形帧不产。 */
        const kind = rec.method;
        const fid = normWidgetFrameId(rec.id);
        if (typeof kind !== "string" || !kind || !fid) return;
        /* 数值 id 同型回传(JSON-RPC 应答 id 应与请求同型,数值 id 引擎若严格
         * 类型匹配才认领;字符串帧归一后即原值)。 */
        const rid = typeof rec.id === "number" ? rec.id : fid;
        void this.raw({ type: "extension_ui_response", id: rid, cancelled: true }).catch(() => undefined);
        if (widgetTier(kind) === "chrome") {
          this.handlers.onBlocks(this.reducer.chromeCancel(kind, clockOf(new Date())), this.reducer.turnStart);
        } else {
          const widget = widgetCancelledNotice({ ...rec, id: fid });
          if (widget) this.handlers.onBlocks(this.reducer.notice(widget.text), this.reducer.turnStart);
        }
        return;
      }
      default:
        return; // ready / extension 噪声 / available_commands / prompt_result / turn_end(结算走 session_settled)等
    }
  }

  /** 带超时的请求多路复用;进程退出统一 reject(prompt 类经 timeoutMs 覆盖)。 */
  private request(cmd: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = `tmd-${++this.seq}`;
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      reject(new Error("rpc 请求超时"));
    }, timeoutMs);
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
