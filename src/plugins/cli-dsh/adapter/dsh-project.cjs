/**
 * DSH mux 帧 → 动作投影(纯函数,可单测)—— 线格式照抄 codemoss events.rs:
 * - 外层信封 {type:"server-request",rpcId,payload} 解包 payload;rpcId 取外层。
 * - 帧类型:session/event(内层 event.type)、approval/requested、question/requested。
 * - assistant/chunk.data.chunk.type: text-delta / reasoning-delta / tool-call-delta / usage
 * - tool/call 携带 view.view: { card, title, kind, locations } —— host 已做结构化卡片
 * - turn/end 成败在 data.reason.kind
 */

function unwrap(raw) {
  if (raw && raw.type === "server-request") {
    return { frame: raw.payload || {}, rpcId: raw.rpcId || null };
  }
  return { frame: raw || {}, rpcId: (raw && raw.rpcId) || null };
}

function sessionIdOf(raw) {
  const s = raw?.sessionId || raw?.payload?.sessionId;
  return typeof s === "string" && s ? s : null;
}

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

/** 单帧 → 动作数组;未识别帧返回 []。动作 shape 见 dsh-adapter.cjs 消费侧。 */
function projectFrame(raw) {
  const sid = sessionIdOf(raw);
  const { frame, rpcId } = unwrap(raw);
  const type = str(frame.type) || "";

  if (type === "session/event") {
    const event = frame.event || frame;
    const et = str(event.type) || "";
    const data = event.data || {};

    if (et === "turn/start") return [{ sid, kind: "turn-start" }];

    if (et === "turn/end") {
      const k = str(data?.reason?.kind) || "completed";
      const failed = ["cancelled", "aborted", "error", "failed"].includes(k);
      /* 实证载荷:reason = {kind:"error", error:{message,code}} — 详情在 reason 内 */
      const error = failed ? str(data?.reason?.error?.message) || str(data?.error?.message) || str(data?.message) || k : null;
      return [{ sid, kind: "turn-end", turnKind: k, error }];
    }

    if (et === "assistant/chunk") {
      const chunk = data.chunk || data;
      const ct = str(chunk.type) || "";
      if (ct === "text-delta") {
        const text = str(chunk.text);
        return text ? [{ sid, kind: "text", text }] : [];
      }
      if (ct === "reasoning-delta") {
        const text = str(chunk.text);
        return text ? [{ sid, kind: "reasoning", text }] : [];
      }
      if (ct === "tool-call-delta") {
        return [{ sid, kind: "tool-delta",
          id: str(chunk.id) || str(chunk.callId),
          name: str(chunk.name),
          delta: str(chunk.argumentsDelta) || "" }];
      }
      if (ct === "usage") {
        const u = chunk.usage || chunk;
        return [{ sid, kind: "usage",
          input: intField(u, ["uncachedInputTokens", "inputTokens", "input"]),
          output: intField(u, ["outputTokens", "output"]),
          cached: intField(u, ["cacheReadTokens", "cachedTokens"]) }];
      }
      return [];
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

  if (type === "approval/requested") {
    const approvalId = str(frame.approvalId) || str(frame.payload?.approvalId);
    if (!approvalId || !rpcId) return [];
    return [{
      sid, kind: "approval", rpcId, approvalId,
      toolName: str(frame.toolName) || str(frame.tool) || str(frame.payload?.toolName) || "dsh-tool",
      message: str(frame.reason) || str(frame.payload?.reason) || str(frame.payload?.message) || "",
    }];
  }

  if (type === "question/requested") {
    const questions = Array.isArray(frame.questions) ? frame.questions
      : Array.isArray(frame.payload?.questions) ? frame.payload.questions : [];
    if (!rpcId) return [];
    return [{ sid, kind: "question", rpcId, questions }];
  }

  return [];
}

module.exports = { projectFrame };
