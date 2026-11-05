/**
 * pi 族 RPC 流式 reducer:NDJSON 事件 → CliTranscriptBlock[]。
 * 设计(docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md):
 * - think/text delta 流内累积;message_end 用 piTranscriptLine 落权威块。
 * - 工具行由 tool_execution_* 帧驱动,跨 assistant 消息存活(实测帧序 =
 *   assistant#1(含 toolCall)end → tool_execution_start/update/end →
 *   assistant#2 流);帧到达即落基座 —— 思考|工具按因果时间线交错占位,
 *   不整轮缓冲到尾部(2026-11-05 三轮:旧轮级缓冲把整轮工具行统一排在
 *   流内思考之后,多步循环底部堆满工具行,实时输出被顶出视野)。
 * - message_end 的 toolCall 项与 role=toolResult 消息不产生块(与 tool_execution
 *   帧重复;实证:双行 tool(bash/called)+tool(undefined) 即此因)。
 * - turnStart 仅作「落定基线」;渲染层切「落定历史|流内活轮」用用户轮界
 *   (最后一个 user 块,ssLiveFrom)——引擎轮界帧在代理多步循环里逐步推进,
 *   turnStart 切界会把在途过程错落成已定折叠组+工具行重复(2026-11-05 实锤)。
 *   结算渲染宽限见 structured-session/ssTurnLive(步间 settled 闪沿不闪回)。
 * cli-shared 准入先例:cli-omp/cli-pi 的 structuredRpc 声明 + structured-session
 * 插件(feature)联合消费(1 cli-* + feature 形态)。
 */
import type { CliTranscriptBlock } from "@kernel/cliSessionTypes";
import { piToolPreview, piTranscriptLine } from "./piTranscript";

/* 部件纯函数已拆至 piRpcWidgets(300 行铁则);此处重导出保持既有 import 面
 * (piRpc.test.ts 从本件引入)。 */
export { widgetCancelledNotice, widgetTier } from "./piRpcWidgets";

const LIVE = "live:";

/** 流内活跃输出面(thinking/text;null = 无流内消息——工具执行间隙/轮末)。 */
export type PiLiveSurface = "thinking" | "text" | null;

/** args 守卫:非对象值(缺省/畸形帧)一律空表。 */
function argsOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
/** 单条 assistant 消息的流内态(message_start..message_end 生命周期)。 */
interface MsgLive {
  role: "assistant" | "user";
  /** 临时块起始下标(撤除时定位)。 */
  at: number;
  thinking: string;
  text: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** content[] 文本抽取(text 项拼接;thinking/toolCall 项跳过)。 */
function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .filter((c): c is { type: string; text?: unknown } => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text")
    .map((c) => (typeof c.text === "string" ? c.text : ""));
  return parts.length ? parts.join("") : undefined;
}

export class PiRpcReducer {
  /** 落定基座(唯一真源;含按帧序落座的工具行,不含流内块)。 */
  private settled: CliTranscriptBlock[] = [];
  private blocks: CliTranscriptBlock[] = [];
  private live: MsgLive | null = null;
  /** 当前全量块(adopt 后置种子驱动 onBlocks 用;feed 同源同值)。 */
  currentBlocks(): CliTranscriptBlock[] {
    return this.blocks;
  }
  turnStart = 0;
  /** 流内活跃输出面(thinking/text):渲染层据此给对应块「流式展开」态。
   * 必须与块位置解耦 —— rebuild 布局中流内块永远在基座(含工具行)之后,
   * 渲染层若按 is-last 判断,轮内第二段起的思考永远不展开(2026-11-05
   * 幕布流缺陷实锤:工具一跑,思考块后再无 last)。消息结算即清。 */
  liveSurface: PiLiveSurface = null;
  /** follow_up 本地回显排队(omp 不发 user 帧,轮首无用户块轮界不可读;下轮
   * 轮界帧注入 settled 尾)。队列制:busy 连发多条互不覆写(单槽静默丢前条)。 */
  private pendingUserEcho: string[] = [];
  /** 轮开闭旗(turn_start 起、session_settled 止):种子剪尾判据,见 hasOpenTurn。 */
  private turnOpen = false;

  /** 接续种子(断线重开换壳保转录 / 磁盘转录补历史)。剪尾条件分两种:
   *  keepTail=false(默认,活流收养/重试重开):settled = 最后一个 user 块
   *  之前的完整轮部分,在途轮不带走——引擎 --resume 可能重放在途轮消息帧,
   *  种子带未完成轮会被整轮再写一遍(2026-11-05 图证实锤);在途轮由引擎
   *  重放/续跑重建,幕布不重复为先。
   *  keepTail=true(关闭会话 resume 重开):磁盘转录是纯已结算历史,引擎
   *  18.x --resume 全程零重放帧(2026-11-05 真机探针实证),剪掉最后一个
   *  user 块 = 单轮会话种子直接变空、多轮丢末轮 —— 全量保留。 */
  seed(blocks: CliTranscriptBlock[], keepTail = false): void {
    const cut = keepTail ? -1 : blocks.findLastIndex((b) => b.role === "user");
    this.settled = cut >= 0 ? blocks.slice(0, cut) : [...blocks];
    this.turnStart = this.settled.length;
    this.turnOpen = false; /* 种子皆为落定基座;在途由后续帧重开 */
    this.rebuild();
  }

  /** 轮在途判据:retry/关闭捕获据此决定种子剪尾 —— 在途轮引擎 resume 会重放,
   *  种子带它即整轮重复(图证实锤);已结算轮 resume 零重放(真机探针实证)。 */
  hasOpenTurn(): boolean {
    return this.turnOpen;
  }

  feed(rec: Record<string, unknown>): CliTranscriptBlock[] {
    const type = rec.type;
    /* 18.6 起轮界帧更名 turn_start(18.4 为 session_start,双名兼容);turn_end
     * 同义忽略,结算走 session_settled(18.6 实测在发)。 */
    if (type === "session_start" || type === "turn_start") {
      /* 先推进轮界再注回显(echo 下标 = 新 turnStart 归活轮切片);反过来会落进上轮。 */
      this.turnStart = this.blocks.length;
      this.turnOpen = true;
      this.flushUserEcho();
    } else if (type === "session_settled") {
      this.turnOpen = false;
      this.settleTurn();
    } else if (type === "agent_start") {
      this.flushUserEcho();
    } else if (type === "message_start") this.startMsg(rec);
    else if (type === "message_update") this.updateMsg(rec);
    else if (type === "message_end") this.endMsg(rec);
    else if (type === "tool_execution_start" || type === "tool_execution_update") this.toolExec(rec, "running");
    else if (type === "tool_execution_end") this.toolExec(rec, rec.isError === true ? "error" : "done");
    return this.blocks;
  }

  /** 回显入队(followUp ack 后;立刻注入会落进尚在途的上轮切片,故等轮界帧)。 */
  queueUserEcho(text: string): void {
    this.pendingUserEcho.push(text);
  }

  /* 注入 settled 尾:turnStart 仍指轮首,注入块下标 ≥ turnStart → 渲染层归活轮。 */
  private flushUserEcho() {
    if (this.pendingUserEcho.length === 0) return;
    const echoes = this.pendingUserEcho;
    this.pendingUserEcho = [];
    const at = this.settled.length;
    this.settled = [
      ...this.settled,
      ...echoes.map((text, i) => ({ id: `${LIVE}f${at + i}`, role: "user" as const, text })),
    ];
    this.rebuild();
  }

  private startMsg(rec: Record<string, unknown>) {
    const role = (rec.message as { role?: unknown } | undefined)?.role;
    if (role !== "assistant" && role !== "user") return; // custom/toolResult 噪声
    if (this.live) this.freezeLive();
    this.liveSurface = null;
    if (role === "user") {
      /* 引擎自带 user 回显帧的端(pi 系可能,omp 无)会对 follow_up 本地回显双写:
       * 末块为本地回显时权威帧接管其位。先撤再取 live.at(下标/定位 id 以撤后为准)。 */
      const last = this.settled[this.settled.length - 1];
      if (last?.role === "user" && last.id.startsWith(`${LIVE}f`)) {
        this.settled = this.settled.slice(0, -1);
      }
    }
    this.live = { role, at: this.settled.length, thinking: "", text: "" };
    if (role === "user") {
      /* 用户回显先行占位,message_end 落定权威文本 */
      this.settled = [...this.settled, { id: `${LIVE}u${this.live.at}`, role: "user", text: "" }];
    }
    this.rebuild();
  }

  private updateMsg(rec: Record<string, unknown>) {
    const live = this.live;
    if (!live || live.role !== "assistant") return;
    const ev = rec.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
    const kind = ev?.type;
    const delta = typeof ev?.delta === "string" ? ev.delta : "";
    if (kind === "thinking_delta" && delta) {
      live.thinking += delta;
      this.liveSurface = "thinking";
    } else if (kind === "text_delta" && delta) {
      live.text += delta;
      this.liveSurface = "text";
    } else return;
    this.rebuild();
  }

  /** 工具行状态机:帧永远生效(不依赖当前消息存活)。首帧落基座(在途流内
   * 消息先冻结,工具行跟在其后 = 因果序);update/end 就地更新同块。 */
  private toolExec(rec: Record<string, unknown>, status: "running" | "done" | "error") {
    const callId = str(rec.toolCallId);
    if (!callId) return;
    const name = str(rec.toolName) || "tool";
    const detail = this.detailOf(rec.partialResult) ?? this.detailOf(rec.result);
    const at = this.settled.findIndex((b) => b.role === "tool" && b.tool?.callId === callId);
    if (at < 0) {
      this.freezeLive();
      this.settled = [...this.settled, {
        id: `${LIVE}k${callId}`,
        role: "tool",
        text: "",
        tool: { callId, title: name, status, detail, preview: piToolPreview(name, argsOf(rec.args)) },
      }];
    } else {
      const prev = this.settled[at].tool!;
      this.settled = this.settled.map((b, i) => (i === at ? { ...b, tool: { ...prev, status, ...(detail ? { detail } : {}) } } : b));
    }
    this.rebuild();
  }

  /** partialResult/result.content[].text 拼接(实测累积式,直接覆盖)。 */
  private detailOf(src: unknown): string | undefined {
    return contentText((src as { content?: unknown } | undefined)?.content);
  }

  private endMsg(rec: Record<string, unknown>) {
    const msg = rec.message as Record<string, unknown> | undefined;
    const role = msg?.role;
    if (role === "user") {
      const text = contentText(msg?.content);
      if (this.live?.role === "user") {
        const at = this.live.at;
        this.live = null;
        this.liveSurface = null;
        if (text) this.settled = this.settled.map((b, i) => (i === at ? { ...b, text } : b));
        this.rebuild();
      }
      return;
    }
    if (role !== "assistant") return;
    /* 权威落定:piTranscriptLine 产 think/text 块;toolCall 项由 tool_execution
     * 工具行代表,过滤。实测 content 的 thinking 项偶被解析器漏读 → 流内思考兜底补位,防丢。 */
    const parsed = (piTranscriptLine({ type: "message", message: msg }) ?? []).filter((b) => b.role !== "tool");
    const live = this.live;
    this.live = null;
    this.liveSurface = null;
    if (live) {
      const fallbackThink: CliTranscriptBlock | null = parsed.some((b) => b.role === "reasoning") || !live.thinking
        ? null
        : { id: `${LIVE}t${live.at}`, role: "reasoning", text: live.thinking };
      const fallbackText: CliTranscriptBlock | null = parsed.some((b) => b.role === "assistant") || !live.text
        ? null
        : { id: `${LIVE}a${live.at}`, role: "assistant", text: live.text };
      const merged = [
        ...(fallbackThink ? [fallbackThink] : []),
        ...parsed,
        ...(fallbackText ? [fallbackText] : []),
      ];
      /* 权威落定只替换流内消息段,尾部保序拼接:live.at 之后流内追加的
       * notice/chrome 聚合块不再被截掉(2026-10-03 范围评审实锤:旧
       * slice(0, live.at) 会静默吞掉它们,而 spec 自述「setStatus 轮次中
       * 也会来」,该窗口真实可达;assistant 无 settled 占位,live.at 之后
       * 即流内追加块)。 */
      this.settled = [...this.settled.slice(0, live.at), ...merged, ...this.settled.slice(live.at)];
    }
    this.rebuild();
  }

  /** 流内重组 = 落定基座(工具行已按帧序在座)+ 当前消息 think/text。 */
  private rebuild() {
    const mid: CliTranscriptBlock[] = [];
    if (this.live?.thinking) mid.push({ id: `${LIVE}t${this.live.at}`, role: "reasoning", text: this.live.thinking });
    if (this.live?.text) mid.push({ id: `${LIVE}a${this.live.at}`, role: "assistant", text: this.live.text });
    this.blocks = [...this.settled, ...mid];
  }

  /** 转录 notice 落定(system 块):协议事件可见化(非 confirm 部件自动取消等),
   * 追加进落定基座尾部(时序 = 事件到达序)。 */
  notice(text: string): CliTranscriptBlock[] {
    this.settled = [...this.settled, { id: `${LIVE}n${this.settled.length}`, role: "system", text }];
    this.rebuild();
    return this.blocks;
  }

  /* chrome 装饰类(setStatus/notify/setWidget)已改为协议层静默应答(piRpc
   * 2026-11-05 减法收口:RPC 视图无承接面,聚合 ×N 行实测仍是噪音),reducer
   * 不再为其产转录块;真交互取消文案见 widgetCancelledNotice。 */

  /** 活消息冻结(无权威帧时兜底;live.thinking/text 进基座)。 */
  private freezeLive() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    this.liveSurface = null;
    if (live.role === "assistant") {
      if (live.thinking) this.settled = [...this.settled, { id: `${LIVE}t${live.at}`, role: "reasoning", text: live.thinking }];
      if (live.text) this.settled = [...this.settled, { id: `${LIVE}a${live.at}`, role: "assistant", text: live.text }];
    }
    this.rebuild();
  }

  /** 轮结算:活消息冻结(工具行已在基座原位),轮界推进。 */
  private settleTurn() {
    this.freezeLive();
    this.blocks = this.settled;
    this.turnStart = this.settled.length;
  }
}
