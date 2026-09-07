/**
 * DSH 适配器 HTTP RPC 客户端 —— 信封照抄 codemoss host.rs:
 * POST /api/<method> {type:"client-request",rpcId,method,payload}
 *   → {type:"server-response",rpcId,result:{ok,value}|{ok:false,error}}。
 * 应答 POST /api/respond {type:"client-response",rpcId,result};
 * result = {ok:true,value} 或 {ok:false,error:{code,message,details}}。
 */

const http = require("http");

const RPC_TIMEOUT_MS = 30_000;

function postJson(url, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on("error", (e) => resolve({ status: 0, text: e.message }));
    req.setTimeout(RPC_TIMEOUT_MS, () => { req.destroy(); resolve({ status: 0, text: "timeout" }); });
    req.write(data);
    req.end();
  });
}

/** 单次 RPC。返回 {ok:true,value} 或 {ok:false,error};永不 reject。 */
async function rpcCall(origin, method, payload) {
  const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { status, text } = await postJson(`${origin}/api/${method}`, {
    type: "client-request", rpcId, method, payload,
  });
  if (!status) return { ok: false, error: text };
  try {
    const env = JSON.parse(text);
    if (env.type === "server-response" && env.rpcId === rpcId) return env.result;
    return { ok: false, error: "unexpected envelope" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function respondResult(origin, rpcId, result) {
  return postJson(`${origin}/api/respond`, { type: "client-response", rpcId, result })
    .then((r) => {
      /* codemoss interpret_respond_receipt 同款:200 但 accepted:false = 拒收
         (not-pending = host 已丢等待者,其余原因打出来防「应答石沉大海」)。 */
      let receipt = null;
      try { receipt = JSON.parse(r.text); } catch { /* 非 JSON 回执按状态判 */ }
      const bad = (r.status && r.status >= 300) || (receipt && receipt.accepted === false);
      if (bad) {
        const reason = receipt && receipt.reason ? receipt.reason : `HTTP ${r.status}`;
        process.stdout.write(`\x1b[31m[错误]\x1b[0m 应答被拒: ${reason}\n`);
      }
      return r;
    });
}

/** 审批应答:outcome = allowed-once | rejected。 */
function respondApproval(origin, rpcId, sessionId, approvalId, outcome) {
  return respondResult(origin, rpcId, {
    ok: true, value: { sessionId, approvalId, outcome },
  });
}

/** 问答应答(codemoss map_question_answers 同款):answers = [{id, selected:[文本]}] 数组。 */
function respondQuestion(origin, rpcId, sessionId, answers) {
  return respondResult(origin, rpcId, {
    ok: true, value: { sessionId, answer: { answers } },
  });
}

/** 问答取消(codemoss respond_error 同款信封)。 */
function respondQuestionCancel(origin, rpcId) {
  return respondResult(origin, rpcId, {
    ok: false,
    error: { code: "cancelled", message: "the user cancelled ask_user_question", details: {} },
  });
}

module.exports = { rpcCall, respondApproval, respondQuestion, respondQuestionCancel };
