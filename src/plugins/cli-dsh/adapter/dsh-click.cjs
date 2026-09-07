/**
 * 幕布鼠标点击路由 —— 交互区(菜单/审批/提问)绘制时开 SGR 鼠标上报(xterm.js 支持),
 * 以「区起点视口行 + 行偏移」命中回调;区收起即关上报(不抢 xterm 文本选择)。
 * 区起点 = requestCursor()(ESC[6n → xterm 回 ESC[行;列R)反推:光标行 − 区高。
 * 非支持终端(管道冒烟/无 CPR)→ resolve null → 不挂区,键盘路径不受影响。
 */

const ON = "\x1b[?1000h\x1b[?1006h";
const OFF = "\x1b[?1000l\x1b[?1006l";
const CPR_TIMEOUT_MS = 400;

let out = null;
let zone = null; /* {start, entries:[fn|null]} */
let tracking = false;
const cprWaiters = [];

function init(stream) { out = stream; }

function setZone(start, entries) {
  zone = { start, entries };
  if (!tracking && out) { out.write(ON); tracking = true; }
}

function clearZone() {
  zone = null;
  if (tracking && out) { out.write(OFF); tracking = false; }
}

/** SGR 左键按下 → 命中当前区第 i 行则触发回调;返回是否消费。 */
function hit(row) {
  if (!zone) return false;
  const i = row - zone.start;
  if (i < 0 || i >= zone.entries.length) return false;
  const fn = zone.entries[i];
  if (!fn) return false;
  fn();
  return true;
}

/** 查询光标视口行(1 基);超时/不支持 → null。 */
function requestCursor() {
  return new Promise((resolve) => {
    if (!out) { resolve(null); return; }
    const entry = { resolve, timer: null };
    entry.timer = setTimeout(() => {
      const k = cprWaiters.indexOf(entry);
      if (k >= 0) cprWaiters.splice(k, 1);
      resolve(null);
    }, CPR_TIMEOUT_MS);
    cprWaiters.push(entry);
    out.write("\x1b[6n");
  });
}

/** keys 解析到 ESC[r;cR 时喂入。 */
function onCpr(row) {
  const entry = cprWaiters.shift();
  if (entry) { clearTimeout(entry.timer); entry.resolve(row); }
}

module.exports = { init, setZone, clearZone, hit, requestCursor, onCpr };
