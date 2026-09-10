#!/usr/bin/env node
/**
 * DSH PTY 适配器 —— 桥接 DSH host-RPC 与 tmd-cli 的 PTY 协议。
 * 拆分:dsh-print(输出门面)/ dsh-stream(底栏所有权)/ dsh-turn(轮次渲染)/
 * dsh-rpc(HTTP+认证)/ dsh-project(remote.mux 投影)/ dsh-commands(命令)/
 * dsh-menu*(交互区)。
 * 0.1.2 线格式:mux = /api/remote.mux 双流(session/follow 会话事件 + $events
 * waterfall);RPC 走 {args} 载荷;全部请求需 BrowserAuth cookie —— 凭据链:
 * --cookie 直用 → --token 换 → 自拉起 host 时从其 stdout 抓 token 换。
 * 退出码:0=正常, 1=启动失败, 2=参数错误。
 */

const { spawn } = require("child_process");
const print = require("./dsh-print.cjs");
const T = require("./dsh-theme.cjs");
const render = require("./dsh-render.cjs");
const { rpcCall, exchangeToken, setAuthCookie, getAuthCookie, setEventsClientId, respondApproval, respondQuestion, respondQuestionCancel } = require("./dsh-rpc.cjs");
const { projectFrame } = require("./dsh-project.cjs");
const { handleStdin, renderHistory, printBanner } = require("./dsh-commands.cjs");
const { createKeyReader } = require("./dsh-keys.cjs");
const { createMenuHost } = require("./dsh-menuhost.cjs");
const { createPendingCards } = require("./dsh-pending.cjs");
const { createTurnEngine } = require("./dsh-turn.cjs");
const menu = require("./dsh-menu.cjs");
const click = require("./dsh-click.cjs");
const { createZone } = require("./dsh-zone.cjs");
const { createStream } = require("./dsh-stream.cjs");
const footer = require("./dsh-footer.cjs");
const { createSpinner } = require("./dsh-spinner.cjs");
const { createThinkStripper } = require("./dsh-think.cjs");

const args = parseArgs(process.argv.slice(2));
if (!args.host || !args.port || !args["workspace-id"]) {
  process.stderr.write("用法: dsh-adapter.cjs --host <h> --port <p> --workspace-id <id> [--workspace-path <p>] [--session-id <id>] [--dsh-bin <bin>] [--cookie <c>] [--token <t>]\n");
  process.exit(2);
}
const ORIGIN = `http://${args.host}:${args.port}`;
const MUX_URL = `ws://${args.host}:${args.port}/api/remote.mux`;
const HOST_READY_MS = 20_000;
const HOST_POLL_MS = 250;
const STREAM_EVENTS = "events";
const STREAM_FOLLOW = "follow";

let dshSessionId = null;
let ws = null;
let hostChild = null;
let closing = false;
const pending = new Map();
/* 会话实况:模型/思考强度/模式(host RPC 校准 + 菜单切换刷新)。 */
let currentModel = ""; let currentEffort = ""; let agentPreset = "standard";
let menuOpen = false; let menuHostRef = null; let cardsRef = null; let keyReader = null;
let turn = null;
/* git 底栏段:本机 shell 采集一次(通用能力,非 dsh 私有);失败留空。 */
const git = { branch: "", dirty: 0 };

/* 底栏行单一所有权:内容写入经 print 代理路由到这里。 */
const stream = createStream((s) => process.stdout.write(s), () => process.stdout.columns || 100, () => process.stdout.rows || 0);
print.install(stream);
const spinner = createSpinner((s) => stream.setStatus(s));
if (process.stdout.isTTY) process.stdout.on("resize", () => stream.resize());
const think = createThinkStripper();

async function main() {
  if (args.cookie) setAuthCookie(args.cookie);
  print.status("连接 DSH host...");
  let desc = await probeHost();
  if (!desc.ok && desc.status === 401 && args.token) {
    const c = await exchangeToken(ORIGIN, args.token);
    if (c) { setAuthCookie(c); desc = await probeHost(); }
  }
  if (!desc.ok) {
    if (desc.status === 401) {
      print.error("host 已在运行但缺访问凭据(cookie/token 缺失或失效)。请在 DSH 面板「停止服务」后重开本会话。");
      process.exit(1);
    }
    print.status("host 未运行,自拉起 dsh web...");
    await spawnHostAndWait();
    desc = await probeHost();
    if (!desc.ok) { print.error(`Host 不可达: ${render.errMsgSafe(desc.error)}`); process.exit(1); }
  }
  /* 默认模型/强度:modelCatalog.default(0.1.2 起 host.describe 删除)。
   * 会话级实况由 follow 快照 projections + syncSessionProjections 校准。 */
  const mc = await rpcCall(ORIGIN, "session/modelCatalog", {});
  if (mc.ok) {
    const d = mc.value?.default || {};
    currentModel = d.provider ? `${d.provider}/${d.model}` : (d.model || "");
    if (d.reasoningEffort) currentEffort = d.reasoningEffort;
  }
  print.status(`已连接 DSH · 模型: ${currentModel || "?"}`);

  const wsRes = await rpcCall(ORIGIN, "workspace/create", { request: { path: args["workspace-path"] || args["workspace-id"] } });
  if (!wsRes.ok) { print.error(`工作区注册失败: ${render.errMsgSafe(wsRes.error)}`); process.exit(1); }
  const workspaceId = wsRes.value.workspace.workspaceId;

  const sessRes = await rpcCall(ORIGIN, "session/create", {
    request: { workspaceId, ...(args["session-id"] ? { sessionId: args["session-id"] } : {}) },
  });
  if (!sessRes.ok) { print.error(`会话创建失败: ${render.errMsgSafe(sessRes.error)}`); process.exit(1); }
  dshSessionId = sessRes.value.sessionId;
  print.status(`会话已就绪: ${dshSessionId}`);
  /* 模式实况 + 上下文窗口:session.list 自项 projections。 */
  turn = createTurnEngine({
    print, stream, spinner, think, render, T, pending,
    /* 空闲底栏 = 常驻 footer:● 模型 › cwd › ⑂ 分支 › 上下文条(仿 pi/omp)。 */
    idleText: (used, window) => footer.buildFooter(T, render, {
      model: currentModel, cwd: args["workspace-path"], branch: git.branch, dirty: git.dirty,
      ctxUsed: used, ctxWindow: window, cols: stream.columns(),
    }),
    closeZones: (why) => {
      if (menuOpen && menuHostRef) menuHostRef.closeFor(why);
      if (cardsRef && pending.size) cardsRef.closeFor(why);
    },
    onEndStats: () => { void syncSessionProjections(); },
  });
  await syncSessionProjections(); /* 首轮灌上下文计量(此前仅同步 agentPreset) */
  footer.gitInfo(args["workspace-path"]).then((g) => {
    if (g) { git.branch = g.branch; git.dirty = g.dirty; if (turn) turn.refreshIdle(); }
  });

  connectMux();
  click.init(process.stdout);
  const zone = createZone(print);
  const commandCtx = {
    ORIGIN, dshSessionId, shutdown,
    get currentModel() { return currentModel; }, set currentModel(mv) { currentModel = mv; },
    get currentEffort() { return currentEffort; }, set currentEffort(v2) { currentEffort = v2; },
    get agentPreset() { return agentPreset; }, set agentPreset(v2) { agentPreset = v2; },
    onSend: () => turn.startTurn(),
  };
  /* 菜单宿主与审批/提问卡共用一个交互区 zone(天然互斥)。 */
  const menuHost = createMenuHost({
    print, rpcCall, ORIGIN, ctx: commandCtx, zone,
    isTurnActive: () => turn.isTurnActive(),
    cancelTurn: doCancelTurn,
    setMenuOpen: (x) => { menuOpen = x; if (x) stream.setStatus(""); else turn.goIdle(); },
    dropLine: () => { if (keyReader) keyReader.dropLine(); },
  });
  const cards = createPendingCards({
    print, render, zone, menu, pending, ORIGIN,
    respondApproval, respondQuestion, respondQuestionCancel,
    onSettled: () => turn.resumeSpinner(),
  });
  menuHostRef = menuHost; cardsRef = cards;
  /* raw 键控可用才挂菜单(管道冒烟退回文本列表)。 */
  const menuEnabled = process.stdin.isTTY === true;
  commandCtx.menuHost = menuEnabled ? menuHost : null;
  const keys = createKeyReader(process.stdin, {
    onLine: (line) => {
      if (cards.onLine(line)) return;
      if (menuEnabled && menuHost.onLine(line)) return;
      void handleStdin(line, commandCtx);
    },
    onKey: (k) => {
      if (k === "close") { shutdown(); return; }
      if (cards.onKey(k)) return;
      if (menuEnabled) menuHost.onKey(k);
    },
    onChar: (ch) => { if (cards.onChar(ch)) { keys.dropLine(); return; } if (menuEnabled) menuHost.onChar(ch); },
    onMouse: (row) => { if (!zone.hit(row)) print.print(T.fg("muted", "(此处无选项可点)")); },
    onWheel: (row, dir) => { if (!cards.onWheel(row, dir) && menuEnabled) menuHost.onWheel(row, dir); },
    onCpr: (row) => click.onCpr(row),
  });
  keyReader = keys;

  turn.goIdle();
}

/** 就绪探针:settings/describe(0.1.2 起 host.describe 删除,零参端点最轻)。 */
function probeHost() {
  return rpcCall(ORIGIN, "settings/describe", {});
}

/** 读 session.list 自项投影:agentPreset/modelSelection/contextPressure → 底栏。 */
async function syncSessionProjections() {
  const sl = await rpcCall(ORIGIN, "session/list", { _request: {} });
  const self = (sl.ok ? sl.value?.items || [] : []).find((s) => s.sessionId === dshSessionId);
  if (!self) return;
  const pv = self.projections?.values || {};
  if (typeof pv.agentPreset === "string" && pv.agentPreset) agentPreset = pv.agentPreset;
  const ms = pv.modelSelection?.next || pv.modelSelection?.lastUsed;
  if (ms?.provider && ms?.model) currentModel = `${ms.provider}/${ms.model}`;
  const cp = pv.contextPressure;
  if (cp && turn) turn.setContext(cp.pressureTokens || 0, cp.contextWindow || 0);
}

/** Esc 取消轮次:发 session/cancel;"⚠ 已取消"由 host 的 turn/end 帧统一打(防重)。 */
async function doCancelTurn() {
  const r = await rpcCall(ORIGIN, "session/cancel", { request: { sessionId: dshSessionId } });
  if (!r.ok) print.error(`取消失败: ${render.errMsgSafe(r.error)}`);
}

/** 自拉起 host 并等就绪;stdout 抓一次性 launch token 换 cookie(0.1.2 门禁)。 */
async function spawnHostAndWait() {
  const bin = args["dsh-bin"] || "dsh";
  let tokenSeen = false;
  try {
    hostChild = spawn(bin, ["web", "--host", args.host, "--port", String(args.port), "--no-open"], { stdio: ["ignore", "pipe", "pipe"] });
    hostChild.stdout.on("data", async (chunk) => {
      if (tokenSeen) return;
      const m = String(chunk).match(/[?&]token=([A-Za-z0-9_-]+)/);
      if (!m) return;
      tokenSeen = true;
      const c = await exchangeToken(ORIGIN, m[1]);
      if (c) setAuthCookie(c);
    });
    hostChild.on("error", () => {});
  } catch { /* 端口被占 = host 已在 */ }
  const deadline = Date.now() + HOST_READY_MS;
  while (Date.now() < deadline) {
    const d = await probeHost();
    if (d.ok) return;
    /* 401 且我方无凭据来源 = host 是外部拉起的:再怎么轮询也不会有 cookie,快速失败 */
    if (d.status === 401 && !args.cookie && !args.token && !tokenSeen) {
      throw new Error("host 已在运行但本适配器无凭据;请在 DSH 面板启动 host 后重开会话");
    }
    await new Promise((r) => setTimeout(r, HOST_POLL_MS));
  }
  throw new Error(tokenSeen ? "host 拉起超时(token 已见,cookie 交换可能失败)" : "host 拉起超时(未见 launch token)");
}

function connectMux() {
  const cookie = getAuthCookie();
  ws = new WebSocket(MUX_URL, cookie ? { headers: { cookie } } : undefined);
  ws.addEventListener("open", () => {
    print.status("Mux 已连接");
    /* 双流:follow = 本会话事件(首帧快照即历史);$events = 审批/提问 waterfall。 */
    ws.send(JSON.stringify({ type: "open", streamId: STREAM_EVENTS, endpoint: "$events", payload: { args: {} } }));
    ws.send(JSON.stringify({
      type: "open", streamId: STREAM_FOLLOW, endpoint: "session/follow",
      payload: { args: { request: { address: { kind: "session", sessionId: dshSessionId }, maxMessages: 200 } } },
    }));
  });
  ws.addEventListener("message", (ev) => {
    let msg;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg.type !== "item") return; /* end/error = 流终结,由 close 统一收口 */
    const channel = msg.streamId === STREAM_EVENTS ? "events" : "follow";
    for (const a of projectFrame(msg.value, channel, dshSessionId)) applyAction(a);
  });
  ws.addEventListener("close", () => { if (!closing) print.error("Mux 断开"); cleanup(); process.exit(0); });
  ws.addEventListener("error", () => { if (!closing) print.error("Mux 错误"); cleanup(); process.exit(1); });
}

/** 帧动作入口:events-ready 登记 clientId;快照灌历史+投影;非本会话丢弃;
 *  审批/提问先亮卡(卡片即等待指示器),其余内容事件收交互区。 */
function applyAction(a) {
  if (a.kind === "events-ready") {
    if (a.clientId) setEventsClientId(a.clientId);
    return;
  }
  if (a.sid && a.sid !== dshSessionId) return;
  if (a.kind === "snapshot") {
    renderHistory(a.records);
    const pv = a.projections?.values || {};
    if (typeof pv.agentPreset === "string" && pv.agentPreset) agentPreset = pv.agentPreset;
    const cp = pv.contextPressure;
    if (cp && turn) turn.setContext(cp.pressureTokens || 0, cp.contextWindow || 0);
    return;
  }
  if (a.kind === "approval" || a.kind === "question") {
    turn.handle(a); /* 收底栏/停 spinner */
    const info = a.kind === "approval"
      ? { kind: "approval", sessionId: a.sid, toolName: a.toolName, message: a.message }
      : { kind: "question", sessionId: a.sid, questions: a.questions };
    pending.set(a.eventId, info);
    if (a.kind === "approval") cardsRef.showApproval(a.eventId, info);
    else cardsRef.showQuestion(a.eventId, info);
    return;
  }
  if (menuOpen && menuHostRef) menuHostRef.closeFor("会话输出到达");
  if (cardsRef && pending.size) cardsRef.closeFor("会话输出到达");
  turn.handle(a);
}

function cleanup() {
  stream.reset(); /* 复位 scroll region:不留缩区给复用的 xterm */
  if (turn) turn.stopAll();
  if (ws) { ws.close(); ws = null; }
}

function shutdown() {
  closing = true;
  cleanup();
  process.exit(0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2), v = argv[i + 1];
      if (v && !v.startsWith("--")) { out[k] = v; i++; } else { out[k] = true; }
    }
  }
  return out;
}

main().catch((e) => { print.error(`启动失败: ${e.message}`); process.exit(1); });
