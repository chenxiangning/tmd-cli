/**
 * 幕布内交互菜单(模型/思考强度/模式选择)—— 纯状态机 + 渲染,零 IO 可单测。
 * 键协议(dsh-adapter raw stdin 分发):↑↓ 移动 / 数字直达 / Enter 确认 / Esc 取消。
 * 重绘契约:render 返回行数组,adapter 记录上次高度,重绘前上移 N 行 + 清尾。
 */

const T = require("./dsh-theme.cjs");
const MAX_VISIBLE = 12;

/** items: [{label, hint?, value}]；currentValue 命中项初始选中。 */
function createMenu(kind, title, items, currentValue) {
  let sel = items.findIndex((it) => it.value === currentValue);
  if (sel < 0) sel = 0;
  return { kind, title, items, sel, height: 0 };
}

function move(menu, delta) {
  const n = menu.items.length;
  if (n) menu.sel = (menu.sel + delta + n) % n;
}

/** 数字键 1-9 → 可视窗内直达;返回是否命中。 */
function pickDigit(menu, d) {
  const top = windowTop(menu);
  const idx = top + d - 1;
  if (idx < 0 || idx >= menu.items.length) return false;
  menu.sel = idx;
  return true;
}

function current(menu) {
  return menu.items[menu.sel] || null;
}

function windowTop(menu) {
  const { sel, items } = menu;
  if (items.length <= MAX_VISIBLE) return 0;
  if (sel < MAX_VISIBLE / 2) return 0;
  if (sel > items.length - MAX_VISIBLE / 2 - 1) return items.length - MAX_VISIBLE;
  return sel - Math.floor(MAX_VISIBLE / 2);
}

/** 渲染行:opts.header=标题行,opts.footer=底部提示;选中 → accent,当前 ✓。 */
function renderLines(menu, opts = {}) {
  const lines = [];
  if (opts.header) lines.push(opts.header);
  else lines.push(T.bold(T.fg("text", menu.title)) + T.fg("muted", "  (↑↓ 选择 · Enter 确认 · 数字直达 · Esc 取消)"));
  const top = windowTop(menu);
  menu.items.slice(top, top + MAX_VISIBLE).forEach((it, i) => {
    const idx = top + i;
    const isSel = idx === menu.sel;
    const mark = it.current ? T.fg("success", " ✓") : "";
    const label = it.hint ? `${it.label}  ${T.fg("muted", it.hint)}` : it.label;
    lines.push(isSel
      ? `  ${T.fg("accent", `→ ${label}`)}${mark}`
      : `    ${T.fg("text", label)}${mark}`);
  });
  if (menu.items.length > MAX_VISIBLE) {
    lines.push(T.fg("muted", `  (${menu.sel + 1}/${menu.items.length})`));
  }
  if (opts.footer) lines.push(opts.footer);
  return lines;
}

module.exports = { createMenu, move, pickDigit, current, renderLines, windowTop, MAX_VISIBLE };
