/**
 * 幕布菜单编排 —— 把 dsh-menu(状态机)接到 DSH RPC:
 * /model 选模型、/effort 选思考强度、/mode 选模式(agentPreset)。
 * 绘制/点击区走 dsh-zone(鼠标行级命中);确认即发 RPC 并收区。
 * deps: { print, rpcCall, ORIGIN, ctx, zone, isTurnActive, cancelTurn, setMenuOpen, dropLine }
 *   ctx: { dshSessionId, currentModel, currentEffort, agentPreset }
 */

const T = require("./dsh-theme.cjs");
const render = require("./dsh-render.cjs");
const menu = require("./dsh-menu.cjs");

function createMenuHost(deps) {
  const { print, rpcCall, ORIGIN, ctx, zone } = deps;
  let m = null; /* 活动菜单 {kind, state} */
  let catalog = null; /* session.models 缓存(带 reasoning.efforts;llm.models 无此字段) */

  const draw = () => {
    if (!m) return;
    const lines = menu.renderLines(m.state);
    /* 每行点击 = 选中该项并确认(标题行 null 不吃) */
    const top = menu.windowTop(m.state);
    const entries = [null];
    m.state.items.slice(top, top + 12).forEach((it, i) => {
      entries.push(() => { m.state.sel = top + i; void confirm(); });
    });
    if (m.state.items.length > 12) entries.push(null);
    zone.show(lines, entries);
  };

  const clear = () => {
    zone.eraseAndHide();
    m = null;
    if (deps.setMenuOpen) deps.setMenuOpen(false);
    if (deps.dropLine) deps.dropLine();
  };

  const closeFor = (why) => {
    if (!m) return;
    clear();
    print.print(T.fg("muted", `(菜单已关闭: ${why})`));
  };

  async function confirm() {
    const item = menu.current(m.state);
    const kind = m.state.kind;
    clear();
    if (!item) return;
    if (kind === "model") await selectModel(item.value, undefined);
    else if (kind === "effort") await selectModel(ctx.currentModel, item.value);
    else if (kind === "mode") await selectPreset(item.value);
  }

  async function selectModel(full, effort) {
    const i = full.indexOf("/");
    const provider = i > 0 ? full.slice(0, i) : "";
    const model = i > 0 ? full.slice(i + 1) : full;
    const r = await rpcCall(ORIGIN, "session/selectModel", {
      request: { sessionId: ctx.dshSessionId, provider, model, ...(effort ? { reasoningEffort: effort } : {}) },
    });
    if (!r.ok) print.error(`切换失败: ${render.errMsgSafe(r.error)}`);
    else {
      /* 响应 selected 是生效实况(含 host 补的默认 effort) */
      const sel = r.value?.selected;
      ctx.currentModel = sel?.provider && sel?.model ? `${sel.provider}/${sel.model}` : full;
      ctx.currentEffort = sel?.reasoningEffort || effort || "";
      print.status(`已切换: ${ctx.currentModel}${ctx.currentEffort ? ` · ${ctx.currentEffort}` : ""}`);
    }
  }

  async function selectPreset(id) {
    const r = await rpcCall(ORIGIN, "agentPresets/select", {
      agentId: ctx.dshSessionId, agentPreset: id,
    });
    if (!r.ok) print.error(`模式切换失败: ${render.errMsgSafe(r.error)}`);
    else { ctx.agentPreset = id; print.status(`模式已切换: ${id}`); }
  }

  async function fetchCatalog() {
    if (!catalog) {
      const r = await rpcCall(ORIGIN, "session/modelCatalog", {});
      if (!r.ok) return null;
      catalog = r.value?.groups || [];
    }
    return catalog;
  }

  async function openModel() {
    const cats = await fetchCatalog();
    if (!cats) { print.error("拉取模型列表失败"); return; }
    const items = [];
    for (const g of cats) {
      for (const mo of g.models || []) {
        if (!mo?.id) continue;
        const value = `${g.id}/${mo.id}`;
        items.push({
          label: mo.name && mo.name !== mo.id ? `${mo.id} (${mo.name})` : mo.id,
          hint: g.name || g.id,
          value,
          current: value === ctx.currentModel,
        });
      }
    }
    openMenu("model", `选择模型 (当前 ${ctx.currentModel || "?"})`, items);
  }

  async function openEffort() {
    if (!ctx.currentModel) { print.error("模型未识别,无法列思考强度"); return; }
    const cats = await fetchCatalog();
    if (!cats) { print.error("拉取模型能力失败"); return; }
    const i = ctx.currentModel.indexOf("/");
    const pid = i > 0 ? ctx.currentModel.slice(0, i) : "";
    const mid = i > 0 ? ctx.currentModel.slice(i + 1) : ctx.currentModel;
    const group = cats.find((g) => g.id === pid);
    const mo = (group?.models || []).find((x) => x.id === mid);
    const efforts = (mo?.reasoning?.efforts || []).map((e) => ({
      label: e.name || e.id, value: e.id, current: e.id === ctx.currentEffort,
    }));
    if (!efforts.length) { print.status("当前模型不支持思考强度设置"); return; }
    openMenu("effort", `思考强度 (当前 ${ctx.currentEffort || "默认"})`, efforts);
  }

  async function openMode() {
    const r = await rpcCall(ORIGIN, "agentPreset.list", {});
    if (!r.ok) { print.error("拉取模式列表失败"); return; }
    const items = (r.value?.presets || [])
      .filter((p) => p && !p.broken)
      .map((p) => ({
        label: p.name || p.id,
        hint: p.description ? render.clip(p.description, 40) : undefined,
        value: p.id,
        current: p.id === ctx.agentPreset,
      }));
    if (!items.length) { print.status("host 未报告任何模式"); return; }
    openMenu("mode", `选择模式 (当前 ${ctx.agentPreset || "standard"})`, items);
  }

  function openMenu(kind, title, items) {
    const cur = items.find((it) => it.current);
    const state = menu.createMenu(kind, title, items, cur ? cur.value : null);
    m = { state };
    if (deps.setMenuOpen) deps.setMenuOpen(true);
    draw();
  }

  /** 滚轮:菜单开 → 移动选中(视窗跟随;1000 模式下 xterm 原生滚动被上报接管)。 */
  function onWheel(row, dir) {
    if (!m) return false;
    menu.move(m.state, dir);
    draw();
    return true;
  }

  function onKey(key) {
    if (m) {
      if (key === "up") { menu.move(m.state, -1); draw(); }
      else if (key === "down") { menu.move(m.state, 1); draw(); }
      else if (key === "esc") { clear(); print.print(T.fg("muted", "(已取消)")); }
      return;
    }
    if (key === "esc" && deps.isTurnActive()) void deps.cancelTurn();
  }

  function onChar(ch) {
    if (!m) return;
    const d = Number(ch);
    if (Number.isInteger(d) && d >= 1 && d <= 9) { menu.pickDigit(m.state, d); draw(); }
  }

  /** 行输入:菜单开 → Enter 即确认(数字直达已移动选中,行内容忽略);菜单关 → 交回 handleStdin。 */
  function onLine(line) {
    if (!m) return false;
    void confirm();
    return true; /* 消费:菜单期不吃 composer 文本 */
  }
  return { onKey, onChar, onLine, onWheel, openModel, openEffort, openMode, closeFor };
}

module.exports = { createMenuHost };
