/**
 * pi 族 RPC 流式 reducer:NDJSON 事件 → CliTranscriptBlock[]。
 * 设计(docs/superpowers/specs/2026-09-30-structured-session-rpc-design.md):
 * - think/text delta 流内累积;message_end 用 piTranscriptLine 落权威块。
 * - 工具行是「轮级」状态机(tool_execution_* 帧驱动,跨 assistant 消息存活):
 *   实测帧序 = assistant#1(含 toolCall)end → tool_execution_start/update/end →
 *   assistant#2 流;工具态挂单消息会在间隙丢失 → 挂在轮上。
 * - message_end 的 toolCall 项与 role=toolResult 消息不产生块(与 tool_execution
 *   帧重复;实证:双行 tool(bash/called)+tool(undefined) 即此因)。
 * - 渲染层切「落定历史|流内活轮」用 turnStart(session_settled 边沿推进)。
 * cli-shared 准入先例:cli-omp/cli-pi 的 structuredRpc 声明 + structured-session
 * 插件(feature)联合消费(1 cli-* + feature 形态)。
 */
import type { CliTranscriptBlock, CliToolPreview } from "@kernel/cliSessionTypes";
import { piToolPreview, piTranscriptLine } from "./piTranscript";

const LIVE = "live:";

/** args 守卫:非对象值(缺省/畸形帧)一律空表。 */
function argsOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

interface ToolLive {
  name: string;
  callId: string;
  status: "running" | "done" | "error";
  detail?: string;
  preview?: CliToolPreview;
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
  /** 落定基座(唯一真源;不含流内块与工具行)。 */
  private settled: CliTranscriptBlock[] = [];
  private blocks: CliTranscriptBlock[] = [];
  private live: MsgLive | null = null;
  /** 轮级工具行(插入序);落定时冻结进 blocks。 */
  private tools = new Map<string, ToolLive>();
  private toolOrder: string[] = [];
  turnStart = 0;

  feed(rec: Record<string, unknown>): CliTranscriptBlock[] {
    const type = rec.type;
    if (type === "session_start") this.turnStart = this.blocks.length;
    else if (type === "agent_start") { this.tools.clear(); this.toolOrder = []; }
    else if (type === "message_start") this.startMsg(rec);
    else if (type === "message_update") this.updateMsg(rec);
    else if (type === "message_end") this.endMsg(rec);
    else if (type === "tool_execution_start" || type === "tool_execution_update") this.toolExec(rec, "running");
    else if (type === "tool_execution_end") this.toolExec(rec, rec.isError === true ? "error" : "done");
    else if (type === "session_settled") this.settleTurn();
    return this.blocks;
  }

  private startMsg(rec: Record<string, unknown>) {
    const role = (rec.message as { role?: unknown } | undefined)?.role;
    if (role !== "assistant" && role !== "user") return; // custom/toolResult 噪声
    if (this.live) this.freezeLive();
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
    if (kind === "thinking_delta" && delta) live.thinking += delta;
    else if (kind === "text_delta" && delta) live.text += delta;
    else return;
    this.rebuild();
  }

  /** 轮级工具行状态机:帧永远生效(不依赖当前消息存活)。 */
  private toolExec(rec: Record<string, unknown>, status: ToolLive["status"]) {
    const id = str(rec.toolCallId);
    if (!id) return;
    let tool = this.tools.get(id);
    if (!tool) {
      tool = { callId: id, name: str(rec.toolName) || "tool", status, preview: piToolPreview(str(rec.toolName) || "tool", argsOf(rec.args)) };
      this.tools.set(id, tool);
      this.toolOrder.push(id);
    } else {
      tool.status = status;
    }
    const detail = this.detailOf(rec.partialResult) ?? this.detailOf(rec.result);
    if (detail) tool.detail = detail;
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
        if (text) this.settled = this.settled.map((b, i) => (i === at ? { ...b, text } : b));
        this.rebuild();
      }
      return;
    }
    if (role !== "assistant") return;
    /* 权威落定:piTranscriptLine 产 think/text 块;toolCall 项由轮级工具行代表,过滤。
     * 实测 content 的 thinking 项偶被解析器漏读 → 流内思考兜底补位,防丢。 */
    const parsed = (piTranscriptLine({ type: "message", message: msg }) ?? []).filter((b) => b.role !== "tool");
    const live = this.live;
    this.live = null;
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
      this.settled = [...this.settled.slice(0, live.at), ...merged];
    }
    this.rebuild();
  }

  /** 流内重组 = 落定基座 + 当前消息 think + 轮级工具行 + 当前消息 text(时序自然)。 */
  private rebuild() {
    const mid: CliTranscriptBlock[] = [];
    if (this.live?.thinking) mid.push({ id: `${LIVE}t${this.live.at}`, role: "reasoning", text: this.live.thinking });
    for (const id of this.toolOrder) {
      const t = this.tools.get(id)!;
      mid.push({
        id: `${LIVE}k${t.callId}`,
        role: "tool",
        text: "",
        tool: { callId: t.callId, title: t.name, status: t.status, detail: t.detail, preview: t.preview },
      });
    }
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

  /** 活消息冻结(无权威帧时兜底;live.thinking/text 进基座)。 */
  private freezeLive() {
    const live = this.live;
    if (!live) return;
    this.live = null;
    if (live.role === "assistant") {
      if (live.thinking) this.settled = [...this.settled, { id: `${LIVE}t${live.at}`, role: "reasoning", text: live.thinking }];
      if (live.text) this.settled = [...this.settled, { id: `${LIVE}a${live.at}`, role: "assistant", text: live.text }];
    }
    this.rebuild();
  }

  /** 轮结算:活消息冻结 + 工具行冻结进基座(时序:工具在活消息之前),轮界推进。 */
  private settleTurn() {
    const liveAt = this.live?.at;
    this.freezeLive();
    const toolBlocks = this.toolOrder.map((id) => {
      const t = this.tools.get(id)!;
      return {
        id: `${LIVE}k${t.callId}`,
        role: "tool" as const,
        text: "",
        tool: { callId: t.callId, title: t.name, status: t.status, detail: t.detail, preview: t.preview },
      };
    });
    const at = liveAt ?? this.settled.length;
    this.settled = [...this.settled.slice(0, at), ...toolBlocks, ...this.settled.slice(at)];
    this.tools.clear();
    this.toolOrder = [];
    this.blocks = this.settled;
    this.turnStart = this.settled.length;
  }
}
