/**
 * 轮次渲染引擎 —— mux 动作 → 底栏/内容行的编排(自 dsh-adapter 拆出)。
 * 实证 DSH 事件流:一个用户轮次 = turn/start → [reasoning/tool/text]×N(多 step,
 * 多次 usage)→ turn/end 仅一次。核心契约:
 * - spinner 整轮常驻(turn/start 起、turn/end 停),绝不按 chunk 起停
 *   (「loading 一会有一会没」根因);内容写入经 dsh-stream 擦/归位底栏,
 *   杜绝 `Working... 50.8s 1: package…` 撞行。
 * - MiniMax 实证把 </mm:think> 吐进正文流 → dsh-think 流式剥离。
 * - turn/end 结算:Took + token 统计行;空闲底栏 = 上下文计量 `mc: X (Y%) · idle`。
 * deps: { print, stream, spinner, think, render, T, pending, usageOf,
 *         onEndStats(u), closeZones(why) }
 */

function createTurnEngine(deps) {
  const { print, stream, spinner, think, render, T, pending } = deps;
  let turnActive = false;
  let turnStartMs = 0;
  let lastUsage = null;
  let ctxUsed = 0;
  let ctxWindow = 0;
  const toolArgsById = new Map();   /* callId → {name,args}:result 回查 */
  const toolStartMs = new Map();    /* callId → startedAt:算 Took */

  function idleStatus() {
    if (deps.idleText) return deps.idleText(ctxUsed, ctxWindow);
    if (!ctxUsed || !ctxWindow) return "";
    const pct = Math.min(100, Math.round((ctxUsed / ctxWindow) * 100));
    return T.fg("muted", `mc: ${T.formatTokens(ctxUsed)} (${pct}%) · idle`);
  }
  function goIdle() { spinner.stop(); stream.setStatus(idleStatus()); }
  function refreshIdle() { if (!turnActive) goIdle(); }

  /** 统计行:↑input ↓output R缓存 (omp footer 同款)。 */
  function statsLine(u) {
    if (!u) return "";
    const ft = T.formatTokens;
    const parts = [];
    if (u.input) parts.push(`↑${ft(u.input)}`);
    if (u.output) parts.push(`↓${ft(u.output)}`);
    if (u.cached) parts.push(`R${ft(u.cached)}`);
    return parts.length ? T.fg("muted", parts.join(" ")) : "";
  }

  function startTurn() {
    turnActive = true; turnStartMs = Date.now(); lastUsage = null;
    stream.endLine();
    spinner.start("Working...", turnStartMs);
  }

  function handle(a) {
    switch (a.kind) {
      case "turn-start":
        startTurn();
        break;

      case "text": {
        const safe = think.feed(a.text);
        if (safe) stream.chunk(safe);
        break;
      }

      case "reasoning":
        stream.chunk(render.thinkingLine(a.text));
        break;

      case "tool-start": {
        const held = think.flush(); if (held) stream.chunk(held);
        stream.endLine();
        if (a.id) { toolArgsById.set(a.id, { name: a.name, args: a.args }); toolStartMs.set(a.id, Date.now()); }
        print.nl();
        print.print(render.band("toolPendingBg", render.toolTitleLine(a.name, a.args)));
        break;
      }

      case "tool-result": {
        const call = a.id ? toolArgsById.get(a.id) : null;
        if (a.id) { toolArgsById.delete(a.id); }
        const name = a.name || call?.name || "tool";
        const bgName = a.error ? "toolErrorBg" : "toolSuccessBg";
        const todos = render.todoLines(call?.args, a.output);
        if (todos) { for (const l of todos) print.print(render.band(bgName, l)); break; }
        const lines = render.toolResultLines(name, a.error || a.output, !!a.error);
        if (name === "bash" && a.id && toolStartMs.has(a.id)) {
          lines.push(render.tookLine(Date.now() - toolStartMs.get(a.id)));
        }
        if (a.id) toolStartMs.delete(a.id);
        for (const l of lines) print.print(render.band(bgName, l));
        break;
      }

      case "usage":
        /* 本轮统计(Took 行用);上下文计量不在此累计 —— usage 帧只有本轮量,
           会话占用唯一真源 = session.list projections(turn/end 后 sync 灌入)。 */
        if (a.input != null || a.output != null) {
          lastUsage = {
            input: a.input ?? lastUsage?.input ?? null,
            output: a.output ?? lastUsage?.output ?? null,
            cached: a.cached ?? lastUsage?.cached ?? null,
          };
        }
        break;

      case "turn-end": {
        turnActive = false;
        const tail = think.flush();
        if (tail) stream.chunk(tail + "\n");
        stream.endLine();
        goIdle();
        print.nl();
        /* 轮次结算:待答卡作废(审批随轮次消亡) */
        if (pending.size) { pending.clear(); deps.closeZones("轮次结束"); }
        const took = turnStartMs ? render.tookLine(Date.now() - turnStartMs) : "";
        const stats = statsLine(lastUsage);
        if (a.turnKind === "completed") print.print([took, stats].filter(Boolean).join(" "));
        else if (a.turnKind === "cancelled" || a.turnKind === "aborted") print.print(T.fg("warning", "⚠ 已取消") + (took ? ` ${took}` : ""));
        else print.print(T.fg("error", `✗ 失败: ${a.error || a.turnKind}`));
        print.nl();
        turnStartMs = 0;
        if (deps.onEndStats) deps.onEndStats(lastUsage);
        break;
      }

      case "approval":
      case "question":
        /* 出卡前收干净:底栏让位给交互区(卡片自身是等待指示器)。 */
        stream.endLine();
        spinner.stop();
        stream.setStatus("");
        break;
    }
  }

  return {
    handle, startTurn, goIdle, refreshIdle,
    isTurnActive: () => turnActive,
    /** 卡片应答/收起后交还底栏:轮次未完续 spinner,已完回 idle 计量。 */
    resumeSpinner: () => { if (turnActive) spinner.start("Working...", turnStartMs); else goIdle(); },
    stopAll() { spinner.stop(); },
    /** session.list projections 灌入上下文计量(图 3 期望)。 */
    setContext(used, window) { if (used) ctxUsed = used; if (window) ctxWindow = window; if (!turnActive) goIdle(); },
  };
}

module.exports = { createTurnEngine };
