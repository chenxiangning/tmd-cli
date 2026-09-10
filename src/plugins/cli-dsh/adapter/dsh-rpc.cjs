/**
 * DSH 适配器 HTTP RPC 客户端 —— 0.1.2 typert gateway 线格式:
 * POST /api/<namespace>/<method> {type:"client-request",rpcId,method,payload:{args}}
 *   → {type:"server-response",rpcId,result:{ok,value}|{ok:false,error}}。
 * 鉴权:BrowserAuth 签名 cookie(dsh-auth-*),setAuthCookie 注入后全请求携带;
 * cookie 用 host 启动期打印的一次性 launch token 换(exchangeToken:
 * GET /?token= → 303 + set-cookie,authority=host:port 绑定)。
 * 审批/提问应答改走 $events/result:POST {args:{clientId,eventId,outcome}},
 * clientId 由 $events 流首帧 ready 给出(setEventsClientId 登记)。
 */

const http = require("http");

const RPC_TIMEOUT_MS = 30_000;
let authCookie = "";
let eventsClientId = null;

function setAuthCookie(c) { authCookie = typeof c === "string" ? c : ""; }
function getAuthCookie() { return authCookie; }
function setEventsClientId(id) { eventsClientId = id; }

function request(url, options = {}) {
  return new Promise((resolve) => {
    const req = http.request(url, options, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, text, res }));
    });
    req.on("error", (e) => resolve({ status: 0, text: e.message, res: null }));
    req.setTimeout(RPC_TIMEOUT_MS, () => { req.destroy(); resolve({ status: 0, text: "timeout", res: null }); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function postJson(url, body) {
  const data = JSON.stringify(body);
  const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) };
  if (authCookie) headers.Cookie = authCookie;
  return request(url, { method: "POST", headers, body: data });
}

/** launch token → cookie(不跟随重定向,读 set-cookie)。失败返回 null。 */
async function exchangeToken(origin, token) {
  const { res } = await request(`${origin}/?token=${encodeURIComponent(token)}`, { method: "GET" });
  const set = res && res.headers["set-cookie"];
  const raw = Array.isArray(set) ? set[0] : set;
  if (!res || res.statusCode !== 303 || typeof raw !== "string") return null;
  return raw.split(";")[0] || null;
}

/**
 * 单次 RPC,args = 调用参数对象(线上一律包 {args})。返回
 * {ok:true,value}|{ok:false,error,status};永不 reject。status 供 401 鉴权判定。
 */
async function rpcCall(origin, method, args) {
  const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { status, text } = await postJson(`${origin}/api/${method}`, {
    type: "client-request", rpcId, method, payload: { args: args || {} },
  });
  if (!status) return { ok: false, error: text, status };
  try {
    const env = JSON.parse(text);
    if (env.type === "server-response" && env.rpcId === rpcId) return { ...env.result, status };
    return { ok: false, error: "unexpected envelope", status };
  } catch (e) {
    return { ok: false, error: e.message, status };
  }
}

/** $events/result 应答;失败打错误行防「应答石沉大海」。 */
async function respondEvent(origin, eventId, outcome) {
  const r = await rpcCall(origin, "$events/result", {
    clientId: eventsClientId, eventId, outcome,
  });
  if (!r.ok) process.stdout.write(`\x1b[31m[错误]\x1b[0m 应答失败: ${r.error}\n`);
  return r;
}

/** 审批应答:outcome = allowed-once | rejected(OUTCOMES 全集含 cancelled/unavailable)。 */
function respondApproval(origin, eventId, outcome) {
  return respondEvent(origin, eventId, { kind: "result", value: outcome });
}

/** 问答应答:answers = [{id, selected:[文本]}] 数组(与官方 client-ui-user-questions 同构)。 */
function respondQuestion(origin, eventId, answers) {
  return respondEvent(origin, eventId, { kind: "result", value: { answers } });
}

/** 问答取消 = rejected outcome(host restoreRemoteEventRejection 还原为取消)。 */
function respondQuestionCancel(origin, eventId) {
  return respondEvent(origin, eventId, {
    kind: "rejected",
    error: { code: "cancelled", message: "the user cancelled ask_user_question" },
  });
}

module.exports = {
  rpcCall, exchangeToken, setAuthCookie, getAuthCookie, setEventsClientId,
  respondApproval, respondQuestion, respondQuestionCancel,
};
