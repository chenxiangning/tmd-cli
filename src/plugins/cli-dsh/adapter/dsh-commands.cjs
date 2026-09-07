/**
 * DSH 命令处理 —— 自 dsh-adapter.cjs 拆出(300 行铁律)。
 * 提供:stdin 命令分发、发送、取消、模型管理(/models 用 omp 风格列表)、
 * 历史加载、banner/help。
 */

const { rpcCall } = require("./dsh-rpc.cjs");
const print = require("./dsh-print.cjs");
const T = require("./dsh-theme.cjs");
const render = require("./dsh-render.cjs");

async function handleStdin(line, ctx) {
  const s = line.trim();
  if (!s) return;
  if (s.startsWith("/")) {
    const [cmd, ...rest] = s.slice(1).split(" ");
    const arg = rest.join(" ");
    if (cmd === "send") await sendPrompt(ctx, arg);
    else if (cmd === "steer") await sendPrompt(ctx, arg, "steer");
    else if (cmd === "context") await doContext(ctx);
    else if (cmd === "cancel") await doCancel(ctx);
    else if (cmd === "model") {
      if (arg) await doModel(ctx, arg);
      else if (ctx.menuHost) ctx.menuHost.openModel();
      else await doModels(ctx);
    }
    else if (cmd === "models") await doModels(ctx);
    else if (cmd === "effort" && ctx.menuHost) ctx.menuHost.openEffort();
    else if (cmd === "mode" && ctx.menuHost) ctx.menuHost.openMode();
    else if (cmd === "exit") ctx.shutdown();
    else if (cmd === "help") printHelp();
    else await doCommand(ctx, s);
    return;
  }
  /* 审批/提问作答已收口 dsh-pending.cjs(adapter 层 cards.onLine 先消费)。 */
  await sendPrompt(ctx, s);
}

/** mode: queue(排队新轮次)/ steer(轮次进行中插话,DSH 原生语义)。 */
async function sendPrompt(ctx, text, mode = "queue") {
  if (!text) return;
  print.nl();
  for (const l of render.userCardLines((mode === "steer" ? "⟶ " : "") + text)) print.print(l);
  if (mode === "queue") ctx.onSend();
  const r = await rpcCall(ctx.ORIGIN, "session.prompt", {
    sessionId: ctx.dshSessionId, mode, content: [{ type: "text", text }],
  });
  if (!r.ok) print.error(`发送失败: ${errMsg(r.error)}`);
}

/** /context:上下文占用明细(session.list 自项 projections)。 */
async function doContext(ctx) {
  const r = await rpcCall(ctx.ORIGIN, "session.list", {});
  const it = (r.ok ? r.value?.items || [] : []).find((s) => s.sessionId === ctx.dshSessionId);
  const v = it?.projections?.values;
  if (!v?.contextPressure) { print.status("host 未返回上下文投影"); return; }
  const cp = v.contextPressure, b = v.contextBreakdown || {}, u = v.tokenUsage || {};
  const k = (n) => (n == null ? "—" : T.formatTokens(n));
  print.nl();
  print.print(T.bold(T.fg("text", "上下文占用:")));
  print.print(`  ${T.fg("muted", "窗口")}: ${k(cp.contextWindow)} · ${T.fg("muted", "已用")}: ${k(cp.pressureTokens)} (${Math.round(((cp.pressureTokens || 0) / (cp.contextWindow || 1)) * 100)}%)`);
  print.print(`  ${T.fg("muted", "分解")}: 系统 ${k(b.systemTokens)} · 工具 ${k(b.toolsTokens)} · 消息 ${k(b.messageTokens)}`);
  print.print(`  ${T.fg("muted", "本轮")}: 输入 ${k(u.uncachedInputTokens)} · 输出 ${k(u.outputTokens)} · 缓存读 ${k(u.cacheReadTokens)}`);
  print.nl();
}

async function doCancel(ctx) {
  const r = await rpcCall(ctx.ORIGIN, "session.cancel", { sessionId: ctx.dshSessionId });
  if (!r.ok) print.error(`取消失败: ${errMsg(r.error)}`);
}

async function doModel(ctx, sel) {
  const parts = sel.split("/");
  const [provider, model] = parts.length === 2 ? parts : ["", parts[0]];
  const r = await rpcCall(ctx.ORIGIN, "session.selectModel", {
    sessionId: ctx.dshSessionId, provider, model,
  });
  if (!r.ok) print.error(`切换失败: ${errMsg(r.error)}`);
  else {
    ctx.currentModel = provider ? `${provider}/${model}` : model;
    print.status(`已切换: ${ctx.currentModel}`);
  }
}

/** 模型列表:omp model-selector 同款(groups 线格式,codemoss flatten_llm_models 同解析)。 */
async function doModels(ctx) {
  const r = await rpcCall(ctx.ORIGIN, "llm.models", {});
  if (!r.ok) { print.error(`拉取失败: ${errMsg(r.error)}`); return; }
  const groups = r.value?.groups || [];
  print.nl();
  print.print(T.bold(T.fg("text", "可用模型:")));
  const lines = render.modelListLines(groups, ctx.currentModel);
  if (lines.length === 0) print.print(T.fg("muted", "  (host 未报告任何模型)"));
  for (const l of lines) print.print(l);
  print.print(T.fg("muted", "  切换: /model <provider/model>"));
  print.nl();
}

async function doCommand(ctx, line) {
  const r = await rpcCall(ctx.ORIGIN, "commands/execute", {
    args: { agentId: ctx.dshSessionId, line, images: [] },
  });
  if (!r.ok) print.error(`命令失败: ${errMsg(r.error)}`);
  else {
    const res = r.value?.result;
    if (res?.kind === "error") print.error(`命令失败: ${res.text || ""}`);
    else print.status(`命令已执行: ${line}`);
  }
}
/** 历史回放:session.history events[] 里的 user/message 与 assistant/message。 */
async function loadHistory(ctx) {
  const r = await rpcCall(ctx.ORIGIN, "session.history", { sessionId: ctx.dshSessionId, maxMessages: 200 });
  const events = r.ok ? r.value?.events : null;
  if (!Array.isArray(events) || !events.length) return;
  print.nl();
  print.print(T.fg("dim", "─── 历史 ───"));
  for (const wrap of events) {
    const ev = wrap?.event;
    if (!ev || (ev.type !== "user/message" && ev.type !== "assistant/message")) continue;
    /* user/message 混有系统注入(agent-instructions/plugin/skill-catalog),只回放真人;
       assistant/message 正文在 data.message.content[](非 data.content)。 */
    const d = ev.data || {};
    let blocks;
    if (ev.type === "user/message") {
      if ((d.source || {}).kind !== "user") continue;
      blocks = d.content || [];
    } else {
      blocks = (d.message || {}).content || [];
    }
    const text = blocks
      .filter((c) => c && c.type === "text")
      .map((c) => c.text)
      .join("\n");
    if (!text.trim()) continue;
    if (ev.type === "user/message") for (const l of render.userCardLines(text)) print.print(l);
    else print.print(T.fg("text", text));
  }
  print.print(T.fg("dim", "─── 历史结束 ───"));
  print.nl();
}

function printBanner(ctx) {
  print.nl();
  const effort = ctx.currentEffort ? ` · 思考 ${ctx.currentEffort}` : "";
  print.print(T.fg("muted", `模型: ${ctx.currentModel || "?"}${effort} · /model 选模型 · /effort 思考强度 · /mode 模式 · Esc 停止`));
  print.nl();
}

function printHelp() {
  print.nl();
  print.print(`  ${T.fg("accent", "/model [p/m]")}   选择菜单或直切模型`);
  print.print(`  ${T.fg("accent", "/effort")}         思考强度选择菜单`);
  print.print(`  ${T.fg("accent", "/mode")}           模式选择菜单(agentPreset)`);
  print.print(`  ${T.fg("accent", "/steer <text>")}   轮次进行中插话`);
  print.print(`  ${T.fg("accent", "/context")}        上下文占用明细`);
  print.print(`  ${T.fg("accent", "/cancel")}         取消轮次(或按 Esc)`);
  print.print(`  ${T.fg("accent", "/exit")}           退出`);
  print.print(T.bold("审批:") + T.fg("muted", " y/n  |  ") + T.bold("提问:") + T.fg("muted", " 题号:选项号 或 c 取消"));
  print.nl();
}

function errMsg(e) { return typeof e === "string" ? e : e?.message || JSON.stringify(e); }

module.exports = { handleStdin, loadHistory, printBanner, printHelp };
