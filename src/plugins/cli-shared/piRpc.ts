/**
 * pi 族(omp/pi)RPC 客户端 —— `--mode rpc` NDJSON 长驻子进程驱动
 * (kernel proc_stream 通用原语之上;协议知识全插件侧,内核零感知)。
 *
 * spawn:`<command> --mode rpc`,总是新会话;adoptStreamId = 收养既有流(reload
 * 重接)。帧:ready/response(按 id 多路复用)、message 族与 tool_execution 族、
 * session_settled;extension_ui_request method="confirm" = 审批回路(绝不自动
 * 批准,答案归 UI)。字段名实证:prompt 用 **message**(18.4.4 传 text 报错)。
 * 设计:docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md
 * cli-shared 准入先例:cli-omp/cli-pi 的 structuredRpc 声明 + structured-session
 * 插件(feature)联合消费(1 cli-* + feature 形态)。
 */
import { ipc } from "@kernel/ipc";
import type { CliTranscriptBlock } from "@kernel/cli";
import { PiRpcReducer } from "./piRpcReducer";
import { handleWidgetFrame } from "./piRpcWidgets";
import {
  parseState,
  type PiRpcCommand, type PiRpcFlavor,
  type PiRpcHandlers, type PiRpcModel, type PiRpcState, type PiRpcStats,
} from "./piRpcTypes";

export type { PiRpcFlavor, PiRpcModel, PiRpcState, PiRpcConfirm, PiRpcStats, PiRpcCommand, PiRpcHandlers } from "./piRpcTypes";
export type { PiLiveSurface } from "./piRpcReducer";
const REQUEST_TIMEOUT_MS = 30_000;
/** prompt 超时:18.6 抓包实证应答为即时 ack(非轮末),与通用闸同值即可。 */
const PROMPT_TIMEOUT_MS = 30_000;
/** 握手超时(get_state):冷启动扩展包加载 5-6s 实证,30s 一刀切逼近上限 → 分层 60s(批次 6)。 */
const START_TIMEOUT_MS = 60_000;

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
    private readonly opts?: {
      resume?: string;
      seedBlocks?: CliTranscriptBlock[];
      /** 构造期种子剪尾旗(retry):末轮在途 false 剪掉防重放重复,已结算 true 全量(见 reducer.seed)。 */
      seedKeepTail?: boolean;
      /** 消费方标签(spawn 透传 proc_stream,boot 枚举按它收养);
       *  adoptStreamId = 收养既有流(reload 重接),跳过 spawn 直接订阅握手。 */
      spawnLabel?: string;
      adoptStreamId?: string;
    },
  ) {
    if (opts?.seedBlocks) this.reducer.seed(opts.seedBlocks, opts.seedKeepTail ?? true);
  }

  /** 轮在途判据(reducer 委托):retry/关闭捕获的种子剪尾决策用。 */
  hasOpenTurn(): boolean { return this.reducer.hasOpenTurn(); }

  /** adopt 后置种子:磁盘转录补 reload 前历史(引擎不重发历史帧,窗口期帧被
   *  seed 覆盖,boot 收养 <1s);keepTail 语义见 reducer.seed。 */
  adoptSeed(blocks: CliTranscriptBlock[], keepTail = false): void {
    this.reducer.seed(blocks, keepTail);
    this.handlers.onBlocks(this.reducer.currentBlocks(), this.reducer.turnStart, this.reducer.liveSurface);
  }

  /** spawn(或收养)子进程并完成 ready/get_state 握手;返回会话身份(parseState 同源)。 */
  async start(): Promise<PiRpcState | null> {
    let id: string;
    if (this.opts?.adoptStreamId) {
      id = this.opts.adoptStreamId;
    } else {
      const spawned = await ipc.procStreamSpawn({
        command: this.flavor.command,
        args: ["--mode", "rpc", ...(this.opts?.resume && this.flavor.resumeArgs ? this.flavor.resumeArgs(this.opts.resume) : [])],
        cwd: this.cwd,
        label: this.opts?.spawnLabel,
      });
      /* spawn await 期间被 kill()(tab 立即关闭等):收割子进程,不订阅不握手。 */
      if (this.disposed) {
        void ipc.procStreamKill(spawned).catch(() => undefined);
        return null;
      }
      id = spawned;
    }
    this.id = id;
    this.stopListeners.push(
      await ipc.onProcStream(id, "out", (line) => this.onLine(line)),
      await ipc.onProcStream(id, "err", (line) => this.handlers.onError(String(line))),
      await ipc.onProcStream(id, "exit", (code) => this.onExit(code as number | null)),
    );
    /* 握手:get_state 即就绪探测(ready 帧只是噪声起点,state 到 = 协议活)。 */
    return this.getState(START_TIMEOUT_MS);
  }

  /** get_state 轻量刷新(set_model/set_thinking_level 后回读权威态);握手路径
   *  经 timeoutMs 分层(START_TIMEOUT_MS,冷启动余量)。 */
  async getState(timeoutMs = REQUEST_TIMEOUT_MS): Promise<PiRpcState | null> {
    const d = (await this.request({ type: "get_state" }, timeoutMs)) as Record<string, unknown> | null;
    return d ? parseState(d) : null;
  }

  /** 发一轮 prompt(字段 message,实证;text 会被 18.4.4 拒);超时走 prompt 专用闸。 */
  async send(text: string): Promise<void> {
    await this.request({ type: "prompt", message: text }, PROMPT_TIMEOUT_MS);
  }

  /** 轮次进行中排队下一条(follow_up;引擎结算后自动起跑,参数 message 与 prompt 同形,18.6 实证)。 */
  async followUp(text: string): Promise<void> {
    await this.request({ type: "follow_up", message: text }, PROMPT_TIMEOUT_MS);
    /* omp 对 follow_up 不发 user 消息帧(首轮回显没有它)——ack 后排队本地
     * 回显,下一轮回界帧注入轮首(立刻注入会落进尚在途的上一轮切片)。 */
    this.reducer.queueUserEcho(text);
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

  private droppedNotified = false;

  private onLine(payload: unknown) {
    const line = String(payload);
    if (!line.startsWith("{")) return;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      /* 帧丢弃观测(批次 6):半行/超限截断行(截断标记致 parse 失败)此前
       * 无声丢;首次丢弃即回告消费方(一次性,聚合无增益)。 */
      if (!this.droppedNotified) {
        this.droppedNotified = true;
        this.handlers.onDroppedFrame?.();
      }
      return;
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
        this.handlers.onToolExecution?.(rec);
        this.handlers.onBlocks(this.reducer.feed(rec), this.reducer.turnStart, this.reducer.liveSurface);
        return;
      case "session_settled":
        this.handlers.onBlocks(this.reducer.feed(rec), this.reducer.turnStart, this.reducer.liveSurface);
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
        handleWidgetFrame(rec, (cmd) => this.raw(cmd), (text) =>
          this.handlers.onBlocks(this.reducer.notice(text), this.reducer.turnStart, this.reducer.liveSurface),
        );
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
