/**
 * 会话装配 —— 工作区注册 + 会话创建/采用(spawn 前置两步)。
 *
 * 采用失败按原因分流:
 * - session/writer-held(会话被 DeepSeek 客户端/另一个 tmd 会话持有写句柄)→
 *   读者模式:不新建,直接 follow 原会话只读打开(DSH 单写者模型,官方 UI 同
 *   一姿势:follow 观察 + sessionInUse 提示);
 * - 其余(子代理子会话 session/agent-busy、会话已被删、归属别的 cwd)不可续接
 *   → 回落新建并带回原因(硬崩会让侧栏留下「点开即失败」的死行)。
 *
 * rpcCall 走末位可选注入(缺省 = 真 HTTP 客户端),便于纯逻辑回归测试。
 */

const { rpcCall: httpRpc } = require("./dsh-rpc.cjs");
const render = require("./dsh-render.cjs");

/** writer-held 重试:3 次 × 1.5s,盖住并发开窗(另一客户端的 create 收尾)。 */
const WRITER_HELD_RETRIES = 3;
const WRITER_HELD_RETRY_MS = 1500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 注册工作区(path 不存在由 host 建);失败 = { ok:false, error }。 */
async function openWorkspace(origin, workspacePath, rpcCall = httpRpc) {
  const res = await rpcCall(origin, "workspace/create", { request: { path: workspacePath } });
  if (!res.ok) return { ok: false, error: res.error };
  const workspaceId = res.value?.workspace?.workspaceId;
  if (!workspaceId) return { ok: false, error: "host 未返回 workspaceId" };
  return { ok: true, workspaceId };
}

/**
 * 创建会话;给了 sessionId 即采用既有会话(磁盘历史续接)。
 * @returns {Promise<
 *   | {ok:true, sessionId:string, mode:"owner", adoptError:string|null, notice:null}
 *   | {ok:true, sessionId:string, mode:"reader", adoptError:null, notice:string}
 *   | {ok:false, error:unknown}>}
 *   - mode "owner" = 本适配器持有写句柄(新建或采用成功);
 *   - mode "reader" = 会话被别的客户端持有写句柄(host 报 session/writer-held,
 *     如 DeepSeek 客户端正开着它):**不新建**,直接以请求的 id 走只读 follow
 *     (session/follow 是纯观察流,不需要写句柄)—— 新建会把「点开会话 X」
 *     变成「得到空白会话 Y」,正是「打不开」的观感;notice 带回 host 原因;
 *   - adoptError 非空 = 采用因其他原因失败已回落新建(调用方提示)。
 */
async function createSession(origin, workspaceId, sessionId, rpcCall = httpRpc, pause = sleep) {
  const call = (id) =>
    rpcCall(origin, "session/create", { request: { workspaceId, ...(id ? { sessionId: id } : {}) } });
  const owner = (id) => ({ ok: true, sessionId: id, mode: "owner", adoptError: null, notice: null });
  let first = await call(sessionId);
  if (first.ok && first.value?.sessionId) return owner(first.value.sessionId);
  if (!sessionId) return { ok: false, error: first.ok ? "host 未返回 sessionId" : first.error };
  /* writer-held 先短暂重试:另一客户端(常见是 DeepSeek 客户端启动恢复会话)
   * 的 create 正在打开同一会话,写句柄在 host 的 writers 表里只存在到它收尾,
   * 之后本端的显式 id 采用是**幂等**的(同一活 agent 直接复用,实测可写入);
   * 重试耗尽仍被占(客户端长期占着无 agent 的附着会话)才退读者模式。 */
  for (let attempt = 0; attempt < WRITER_HELD_RETRIES && first.error?.code === "session/writer-held"; attempt++) {
    await pause(WRITER_HELD_RETRY_MS);
    first = await call(sessionId);
    if (first.ok && first.value?.sessionId) return owner(first.value.sessionId);
  }
  if (first.error?.code === "session/writer-held") {
    return { ok: true, sessionId, mode: "reader", adoptError: null, notice: render.errMsgSafe(first.error) };
  }
  const retry = await call("");
  if (!retry.ok || !retry.value?.sessionId) {
    return { ok: false, error: retry.ok ? "host 未返回 sessionId" : retry.error };
  }
  return { ok: true, sessionId: retry.value.sessionId, mode: "owner", adoptError: render.errMsgSafe(first.error), notice: null };
}

module.exports = { openWorkspace, createSession };
