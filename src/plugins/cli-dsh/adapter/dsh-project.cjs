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
    let isError = false;
    for (const b of blocks) {
      if (b && b.isError === true) { isError = true; break; }
    }
    return [{ sid, kind: "tool-result",
      id: str(data.message?.source?.callId) || str(data.callId) || null,
      name: toolName,
      output,
      error: isError
        ? (str(output) || "error")
        : (str(err) || (err && str(err.message)) || null) }];
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
      return [{ sid: sessionId, kind: "snapshot",
        records: Array.isArray(v.records) ? v.records : [],
        header: v.header || null,
        projections: v.projections || null }];
    }
    return [];
  }
  if (channel === "events") {
    if (v.type === "ready") return [{ sid: null, kind: "events-ready", clientId: v.clientId || null }];
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
