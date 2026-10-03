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
import { t } from "@kernel/i18n";
import type { CliTranscriptBlock } from "@kernel/cli";
import { PiRpcReducer } from "./piRpcReducer";

/** 家族分叉:启动命令(monocode piFlavor 同参照)。 */
export interface PiRpcFlavor {
  command: string;
}

/** 审批请求(extension_ui_request confirm;答案经 respond 回写)。
 *  frameId 保原始类型(JSON-RPC id 可为数字;数值 confirm 帧若被字符串化,
 *  引擎同型匹配不认领 → 审批静默丢失挂死轮次 —— 与 normWidgetFrameId 同律,
 *  2026-10-03 二轮复查);React key 与 respond 透传都吃 string|number。 */
export interface PiRpcConfirm {
  frameId: string | number;
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
/** prompt 类请求超时(独立常量):prompt 应答时机待真机实证 —— rpc 模式下
 * response 是否轮末才回尚无抓包数据,先与通用闸同值,实证后单独收口。 */
const PROMPT_TIMEOUT_MS = 30_000;

/** 时分秒(词典无关的 locale 中立形态;notice 时刻用)。 */
function clockOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 非 confirm 部件自动取消判定(纯函数,单测钉死):extension_ui_request 且
 * method 非 confirm(select/input/editor 等真交互部件)时,RPC 模式无人可答,
 * 按协议回 cancelled 并产转录 notice 文案 —— 不再无声替答;confirm 走审批
 * 回路不在此列;chrome 装饰类(widgetTier 判 chrome)不经此函数,走
 * reducer.chromeCancel 聚合;缺 id 的畸形帧不产(无处应答也无从示警;调用侧
 * 已将数值 id 归一为字符串,见 normWidgetFrameId)。 */
export function widgetCancelledNotice(
  rec: Record<string, unknown>,
  now: Date = new Date(),
): { frameId: string; kind: string; text: string } | null {
  if (rec.type !== "extension_ui_request") return null;
  const kind = rec.method;
  if (typeof kind !== "string" || !kind || kind === "confirm") return null;
  const frameId = rec.id;
  if (typeof frameId !== "string" || !frameId) return null;
  return {
    frameId,
    kind,
    text: `${t("CLI 发起 {kind} 交互,已按协议自动取消", { kind })}(${clockOf(now)})`,
  };
}

/** TUI 装饰类部件(omp 18.x 启动/轮次帧实证:setStatus 状态行、notify 通知、
 * setWidget 小部件注册):RPC 模式下永远无意义,取消后聚合一处降噪,不逐条
 * 落行(2026-10-02 spec);select/input/editor 等真交互与未知 kind 一律
 * interactive 逐条可见——宁可多显示不可静默。 */
const CHROME_WIDGET_KINDS = new Set(["setStatus", "notify", "setWidget"]);

/** 部件分档(纯函数,单测钉死):chrome = TUI 装饰,interactive = 其余一切。 */
export function widgetTier(kind: string): "chrome" | "interactive" {
  return CHROME_WIDGET_KINDS.has(kind) ? "chrome" : "interactive";
}

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

  /** 发一轮 prompt(字段 message,实证;text 会被 18.4.4 拒);超时走 prompt 专用闸。 */
  async send(text: string): Promise<void> {
    await this.request({ type: "prompt", message: text }, PROMPT_TIMEOUT_MS);
  }

  /** 中止在途轮。 */
  async abort(): Promise<void> {
    await this.request({ type: "abort" }).catch(() => undefined);
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
        return; // ready / extension 噪声 / available_commands / prompt_result 等
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
