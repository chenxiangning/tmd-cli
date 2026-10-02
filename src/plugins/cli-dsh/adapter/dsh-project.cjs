/**
 * DSH remote.mux 帧 → 动作投影(纯函数,可单测)—— 0.1.2 typert gateway 线格式。
 * 入参 = mux 下行帧的 value + 流角色:
 * - follow 流:{type:"event",event:{type,seq,time,data}} 会话事件;
 *   {type:"snapshot",header,cursor,records,hasMore,projections} 历史快照。
 * - $events 流:{type:"ready",clientId,host};{type:"waterfall",event,eventId,
 *   agentId,request} 审批/提问调用(approval/request、user-questions/request),
 *   应答经 $events/result,rpcId 位即 eventId。
 * - 事件词表(host 0.1.5-rc.1 真 turn 抓帧):turn/start|end(reason.kind 判成败)、
 *   step/start|end、user/message、assistant/message(整消息沉降,content 块 =
 *   text/tool-call,usage 挂 data.usage)、tool/call、tool/result。
 *   chunkrow/* 变体为历史分页编码,活流不出现,不投影。
 * - 流式真身:follow 订阅带 assistantStream: true 时追加 assistant-stream
 *   帧(start / chunk{text-delta|reasoning-delta|usage|...} / end committed),
 *   durable assistant/message 仍随后沉降 —— 消费方须按「attempt 有过增量则
 *   跳过 durable 正文」去重(2026-09-12 真机抓帧,codemoss 同款接法)。
 */

function str(v) {
  return typeof v === "string" && v ? v : null;
}

function intField(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null) {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return Math.trunc(n);
    }
  }
  return null;
}

/** message.content 块 → 纯文本(tool-result 载荷形态:text 块或 tool-result 嵌套块)。 */
function extractText(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (!b) continue;
    if (b.type === "text" && typeof b.text === "string") out.push(b.text);
    else if (b.type === "tool-result") {
      const inner = Array.isArray(b.content) ? b.content : [];
      for (const c of inner) if (c && c.type === "text" && typeof c.text === "string") out.push(c.text);
      if (inner.length === 0 && typeof b.content === "string") out.push(b.content);
    }
  }
  return out.length ? out.join("\n") : null;
}

/** DSH read 结果带 <path>/<type>/<content> XML 包装;拆出正文并去脚注。 */
function unwrapReadResult(text) {
  if (typeof text !== "string") return text;
  const m = text.match(/<content>\n([\s\S]*?)\n<\/content>/);
  if (!m) return text;
  return m[1].replace(/\n\((?:End of file|Showing|More content)[^)]*\)\s*$/g, "").replace(/\n+$/, "");
}

/** 会话事件 → 动作;未识别事件返回 []。 */
function projectEvent(event, sid) {
  const et = str(event.type) || "";
  const data = event.data || {};

  if (et === "turn/start") return [{ sid, kind: "turn-start" }];

  if (et === "turn/end") {
    const k = str(data?.reason?.kind) || "completed";
    const failed = ["cancelled", "aborted", "error", "failed"].includes(k);
    const error = failed ? str(data?.reason?.error?.message) || str(data?.error?.message) || str(data?.message) || k : null;
    return [{ sid, kind: "turn-end", turnKind: k, error }];
  }

  /* assistant/message(0.1.5 实测):整消息沉降,content 块带 text / tool-call;
   * 流式 chunk 不进 session 日志,follow 流无 assistant/chunk(旧会话格式遗产)。
   * usage 挂在事件 data 上(live.usage 随 settle 一并 append)。 */
  if (et === "assistant/message") {
    const msg = data.message || {};
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const actions = [];
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "text" && str(b.text)) actions.push({ sid, kind: "text", text: b.text });
      else if (b.type === "reasoning" && str(b.text)) actions.push({ sid, kind: "reasoning", text: b.text });
    }
    const u = data.usage;
    if (u) {
      actions.push({ sid, kind: "usage",
        input: intField(u, ["uncachedInputTokens", "inputTokens", "input"]),
        output: intField(u, ["outputTokens", "output"]),
        cached: intField(u, ["cacheReadTokens", "cachedTokens"]) });
    }
    return actions;
  }

  if (et === "tool/call") {
    const v = data.view?.view || data.view || {};
    return [{ sid, kind: "tool-start",
      id: str(data.callId) || str(data.id),
      name: str(data.name) || "tool",
      args: data.arguments ?? data.args ?? null,
      card: str(v.card) || "generic",
      title: str(v.title) || null,
      toolKind: str(v.kind) || null,
      locations: Array.isArray(v.locations) ? v.locations : null }];
  }

  if (et === "tool/result") {
    const err = data.error;
    const blocks = Array.isArray(data.message?.content) ? data.message.content : [];
    const toolName = str(data.name) || null;
    let output = data.result ?? data.output ?? extractText(blocks);
    output = unwrapReadResult(output);
    /* 失败判据两代都要认(2026-10-02 真实会话盘采样):
     * - v3 包裹形:isError 在 message.content 的 tool-result part 上(实测 ERR 帧);
     * - v4 扁平形:isError 在 message 本体(toolCallId 也在本体);
     * - 失败帧另带 data.error = {name,code[,reason]}(无 message 字段)。
     * 旧实现只看 content block 的 isError,v4 帧的失败全部按成功渲染(绿底)。 */
    const directError = data.message?.isError === true;
    let isError = directError || !!err;
    if (!isError) {
      for (const b of blocks) {
        if (b && b.isError === true) { isError = true; break; }
      }
    }
    const reason = str(err?.reason) || str(err?.code) || str(err?.name) || null;
    return [{ sid, kind: "tool-result",
      id: str(data.message?.toolCallId) || str(data.message?.source?.callId) || str(data.callId) || null,
      name: toolName,
      output,
      /* error 既是失败标志也是失败文案:有 host 原因用原因,否则退回输出首段。 */
      error: isError ? (reason || str(output) || "error") : null }];
  }

  return [];
}

/**
 * 单帧 value → 动作数组。channel = "follow" | "events";sessionId 只对 follow
 * 流有意义(流即会话);waterfall 的会话身份取 agentId。
 */
/* assistant-stream 活帧(assistantStream opt-in)→ 动作投影。
 * start 复位 attempt;chunk 按 chunk.type 分流(text/reasoning 增量、
 * usage 与 durable 同构);end 仅 committed 有意义(settlement 键)。
 * 消费方契约:见模块头注 —— attempt 有过增量就跳过 durable 正文。 */
function projectAssistantStream(value, sessionId) {
  const frame = value.frame || {};
  const sid = sessionId;
  const ftype = str(frame.type);
  if (ftype === "start") return [{ sid, kind: "attempt-start", attemptId: str(frame.attemptId) }];
  if (ftype === "end") {
    return [{ sid, kind: "attempt-end", committed: frame.outcome?.kind === "committed" }];
  }
  if (ftype !== "chunk") return [];
  const chunk = frame.chunk || {};
  switch (str(chunk.type)) {
    case "text-delta":
      return str(chunk.text) ? [{ sid, kind: "text-delta", text: chunk.text }] : [];
    case "reasoning-delta":
      return str(chunk.text) ? [{ sid, kind: "reasoning-delta", text: chunk.text }] : [];
    case "usage": {
      const u = chunk.usage || {};
      return [{ sid, kind: "usage",
        input: intField(u, ["uncachedInputTokens", "inputTokens", "input"]),
        output: intField(u, ["outputTokens", "output"]),
        cached: intField(u, ["cacheReadTokens", "cachedTokens"]) }];
    }
    default:
      return []; /* block-start/end、tool-call-delta、finish:durable 侧已有投影 */
  }
}

function projectFrame(value, channel, sessionId) {
  const v = value || {};
  if (channel === "follow") {
    if (v.type === "assistant-stream") return projectAssistantStream(v, sessionId);
    if (v.type === "event" && v.event) return projectEvent(v.event, sessionId);
    if (v.type === "snapshot") {
      const actions = [{ sid: sessionId, kind: "snapshot",
        records: Array.isArray(v.records) ? v.records : [],
        header: v.header || null,
        projections: v.projections || null }];
      /* 流式中途重开(适配器重启/另一个客户端在跑):快照带
       * assistantStream.activeAttempt.stream = 已流出的活体前缀帧
       * ({time,chunk} 数组,dsh-api-session-controller AssistantStreamAccumulator
       * 实证)。不补投影这段前缀,重开后只有后半段增量,而 settle 后的 durable
       * assistant/message 又被 attemptStreamed 去重 → 整条回复永久缺头。 */
      const stream = v.assistantStream?.activeAttempt?.stream;
      if (Array.isArray(stream) && stream.length > 0) {
        actions.push({ sid: sessionId, kind: "attempt-start",
          attemptId: str(v.assistantStream?.activeAttempt?.attemptId) });
        for (const entry of stream) {
          if (entry && entry.chunk) actions.push(...projectAssistantStream({ frame: { type: "chunk", chunk: entry.chunk } }, sessionId));
        }
      }
      return actions;
    }
    return [];
  }
  if (channel === "events") {
    if (v.type === "ready") return [{ sid: null, kind: "events-ready", clientId: v.clientId || null }];
    /* 待答 waterfall 被撤销(host 侧超时/另一端已作答/栅栏):收卡清 pending,
     * 否则卡片一直挂着,↑↓ 被死卡吞、y/n 把陈旧 eventId 发出去。 */
    if (v.type === "cancel") {
      const eventId = str(v.eventId);
      return eventId ? [{ sid: null, kind: "cancel", eventId }] : [];
    }
    if (v.type === "waterfall") {
      const sid = str(v.agentId);
      const eventId = str(v.eventId);
      if (!eventId) return [];
      if (v.event === "approval/request") {
        return [{ sid, kind: "approval", eventId,
          toolName: str(v.request?.toolName) || "dsh-tool",
          message: str(v.request?.reason) || str(v.request?.message) || "" }];
      }
      if (v.event === "user-questions/request") {
        const questions = Array.isArray(v.request?.questions) ? v.request.questions : [];
        return [{ sid, kind: "question", eventId, questions }];
      }
    }
    return [];
  }
  return [];
}

module.exports = { projectFrame, projectAssistantStream };
