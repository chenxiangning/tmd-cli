/**
 * 审批/提问交互卡 —— 与幕布菜单同款状态机(dsh-menu):↑↓/滚轮移动选中、
 * Enter 确认、Esc 拒绝(审批)/取消(提问)、y/n 与数字 raw 下即时应答、
 * 鼠标点击 = 选中该项并确认(带 → 高亮)。自 dsh-adapter.cjs 拆出(300 行铁则)。
 * deps: { print, render, zone, menu, pending, ORIGIN,
 *         respondApproval, respondQuestion, respondQuestionCancel }
 */

const T = require("./dsh-theme.cjs");

function createPendingCards(deps) {
  const { print, render, zone, menu, pending, ORIGIN } = deps;
  const { respondApproval, respondQuestion, respondQuestionCancel } = deps;
  let cur = null; /* {rpcId(=waterfall eventId), info, state:dsh-menu 状态} */

  function headerOf(info) {
    if (info.kind === "approval") {
      return render.band("userBg", T.fg("warning", T.bold(
        `[DSH 审批] ${info.toolName || "工具"}${info.message ? `: ${info.message}` : ""}`)));
    }
    const qs = (info.questions || [])
      .map((q, i) => `${i + 1}. ${q.header || q.question || ""}`).join(" · ");
    return render.band("userBg", T.fg("warning", T.bold(`[DSH 提问] ${qs}`)));
  }

  function draw() {
    if (!cur) return;
    const approval = cur.info.kind === "approval";
    const lines = menu.renderLines(cur.state, {
      header: headerOf(cur.info),
      footer: T.fg("muted", approval
        ? "  ↑↓ 选择 · Enter 确认 · y/n 即时应答 · Esc 拒绝"
        : "  ↑↓ 选择 · Enter 确认 · 数字即时应答 · c 取消 · Esc 跳过"),
    });
    const top = menu.windowTop(cur.state);
    const entries = [null];
    cur.state.items.slice(top, top + menu.MAX_VISIBLE).forEach((_it, i) => {
      entries.push(() => { if (cur) { cur.state.sel = top + i; void confirmCurrent(); } });
    });
    if (cur.state.items.length > menu.MAX_VISIBLE) entries.push(null); /* 计数行 */
    entries.push(null); /* footer 行 */
    zone.show(lines, entries);
  }

  function showApproval(rpcId, info) {
    print.nl();
    const state = menu.createMenu("approval", "", [
      { label: "允许", value: "allowed-once" },
      { label: "拒绝", value: "rejected" },
    ], null);
    cur = { rpcId, info, state };
    draw();
  }

  function showQuestion(rpcId, info) {
    print.nl();
    const items = [];
    (info.questions || []).forEach((q, i) => (q.options || []).forEach((o, j) => {
      const label = String(o.label || o);
      items.push({ label: `${i + 1}:${j + 1} ${label}`, value: { qIdx: i, oIdx: j, label } });
    }));
    cur = { rpcId, info, state: menu.createMenu("question", "", items, null) };
    draw();
  }

  /** 结算:清选中态与 pending,块留滚动历史。spinner 续转由各应答路径
   *  在打印「应答」文本之后调 resumeSpinner(先文本后 spinner,防覆写撞行)。 */
  function settle() {
    if (!cur) return;
    pending.delete(cur.rpcId);
    cur = null;
    zone.hide();
  }
  function resumeSpinner() { if (deps.onSettled) deps.onSettled(); }

  function answerApproval(rpcId, info, outcome) {
    print.status(`应答: ${outcome === "allowed-once" ? "允许" : "拒绝"}`);
    void respondApproval(ORIGIN, rpcId, outcome);
    resumeSpinner();
  }

  /** pick = 选项文本;custom = 自由文本(官方 schema 的 custom 字段)。 */
  function answerQuestion(rpcId, info, qIdx, pick) {
    print.status(`应答: ${pick.label != null ? pick.label : `自定义「${pick.custom}」`}`);
    const answers = (info.questions || []).map((q, i) => ({
      id: q.id || `q${i + 1}`,
      selected: i === qIdx && pick.label != null ? [pick.label] : [],
      ...(i === qIdx && pick.custom != null ? { custom: pick.custom } : {}),
    }));
    void respondQuestion(ORIGIN, rpcId, answers);
    resumeSpinner();
  }

  function cancelQuestion(rpcId) {
    print.status("取消提问");
    void respondQuestionCancel(ORIGIN, rpcId);
    resumeSpinner();
  }

  async function confirmCurrent() {
    if (!cur) return;
    const item = menu.current(cur.state);
    if (!item) return;
    const { rpcId, info } = cur;
    settle();
    if (info.kind === "approval") answerApproval(rpcId, info, item.value);
    else answerQuestion(rpcId, info, item.value.qIdx, { label: item.value.label });
  }

  /** 交互键;卡开着消费(含吞掉防 menuHost 劫持),否则 false 放行。 */
  function onKey(k) {
    if (!cur) return false;
    if (k === "up") { menu.move(cur.state, -1); draw(); }
    else if (k === "down") { menu.move(cur.state, 1); draw(); }
    else if (k === "esc") {
      const { rpcId, info } = cur;
      settle();
      if (info.kind === "approval") answerApproval(rpcId, info, "rejected");
      else cancelQuestion(rpcId);
    }
    return true;
  }

  function onWheel(_row, dir) {
    if (!cur) return false;
    menu.move(cur.state, dir);
    draw();
    return true;
  }

  /** raw 即时应答:审批 y/n;提问数字 = 可视窗内直达并作答。返回是否消费。 */
  function onChar(ch) {
    if (!cur) return false;
    if (cur.info.kind === "approval") {
      if (ch === "y" || ch === "n") {
        const { rpcId, info } = cur;
        settle();
        answerApproval(rpcId, info, ch === "y" ? "allowed-once" : "rejected");
        return true;
      }
      return false;
    }
    const d = Number(ch);
    if (Number.isInteger(d) && d >= 1 && d <= 9) {
      const top = menu.windowTop(cur.state);
      const it = cur.state.items[top + d - 1];
      if (it) {
        const { rpcId, info } = cur;
        settle();
        answerQuestion(rpcId, info, it.value.qIdx, { label: it.value.label });
        return true;
      }
    }
    return false;
  }

  /** 行输入(Enter)。**pending 挂起时一切输入都收进应答路径,绝不漏进 prompt
   *  队列**(agent 阻塞在提问上,队列消息永不消费 = 「续接无效」实证根因):
   *  空行=确认选中;y/n、c、题:选=选项应答;自由文本=单问 custom。 */
  function onLine(line) {
    const s = line.trim();
    if (cur && !s) { void confirmCurrent(); return true; }
    if (!pending.size || !s) return false;
    const [rpcId, info] = pending.entries().next().value;
    if (info.kind === "approval") {
      if (s === "y" || s === "n") {
        settle();
        answerApproval(rpcId, info, s === "y" ? "allowed-once" : "rejected");
      } else {
        print.status('审批等待中:输入 y 允许 / n 拒绝(其他文本不会发送)');
      }
      return true;
    }
    if (s === "c") { settle(); cancelQuestion(rpcId); return true; }
    const m = s.match(/^(\d+):(\d+)$/);
    if (m) {
      const q = info.questions[Number(m[1]) - 1];
      const opt = q?.options?.[Number(m[2]) - 1];
      if (q && opt) {
        settle();
        answerQuestion(rpcId, info, Number(m[1]) - 1, { label: String(opt.label || opt) });
        return true;
      }
    }
    /* 自由文本:单问 → custom 应答;多问 → 提示走 题:选(不猜意图,仍消费防漏队列) */
    if ((info.questions || []).length === 1) {
      settle();
      answerQuestion(rpcId, info, 0, { custom: s });
    } else {
      print.status('多问题待答:输入「题号:选项号」作答,或 c 取消(其他文本不会发送)');
    }
    return true;
  }

  /** 会话事件到达时收起(重绘行带会错位);pending 保留,文本作答仍可用。 */
  function closeFor(why) {
    if (!cur) return;
    cur = null;
    zone.hide();
    print.print(T.fg("muted", `(卡片已收起: ${why};输入 y/n 或 题:选 仍可作答)`));
  }

  return { showApproval, showQuestion, onKey, onWheel, onChar, onLine, closeFor };
}

module.exports = { createPendingCards };
