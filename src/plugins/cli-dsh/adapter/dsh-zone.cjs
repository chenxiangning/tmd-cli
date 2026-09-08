/**
 * 交互区原语 —— 绘制 N 行 + ESC[6n 反推区起点 + 挂鼠标点击区。
 * 供菜单宿主(选模型/强度/模式)与审批/提问卡共用:一个时刻只有一个活动区
 * (菜单只在空闲时开,审批/提问阻塞轮次,天然互斥)。
 * 行宽裁切防换行(换行会让「区起点 + 偏移」错位)。
 */

const click = require("./dsh-click.cjs");

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b./g;

/* CJK/全角终端占 2 列(与 dsh-render.displayWidth 同表):按字符数算宽会让
   裁切失效 → band 行超宽换行 → 重绘 erase 错位(提问卡叠影实证)。 */
const WIDE_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
function plainWidth(s) {
  let w = 0;
  for (const ch of s.replace(ANSI_RE, "")) w += WIDE_RE.test(ch) ? 2 : 1;
  return w;
}

/** 可见宽度裁到终端宽(保留 ANSI 码;CJK 记 2)。 */
function clipWidth(print, s) {
  const max = (print.columns && print.columns()) || 100;
  if (plainWidth(s) <= max) return s;
  let out = "", vis = 0, i = 0;
  while (i < s.length && vis < max - 2) {
    if (s[i] === "\x1b") {
      const m = /^[^\x07]*\x07|^\[[0-9;?]*[A-Za-z]|^./.exec(s.slice(i));
      out += m[0]; i += m[0].length; continue;
    }
    out += s[i]; vis += WIDE_RE.test(s[i]) ? 2 : 1; i++;
  }
  return out + "…\x1b[39m\x1b[49m";
}

function createZone(print) {
  let cur = null; /* {lines, entries, height, seq} */
  let seq = 0;

  const erase = () => {
    if (cur && cur.height > 0) print.write(`\x1b[${cur.height}A\x1b[J`);
  };

  /** 绘制/重绘:上移旧块 → 画新行 → CPR 定位挂点击区。 */
  function show(lines, entries) {
    const clipped = lines.map((l) => clipWidth(print, l));
    erase();
    for (const l of clipped) print.print(l);
    const mine = ++seq;
    cur = { lines: clipped, entries, height: clipped.length, seq: mine };
    click.requestCursor().then((row) => {
      if (!cur || cur.seq !== mine) return; /* 期间被替换/关闭 */
      if (row == null) return; /* 终端不支持 CPR:退回纯键盘 */
      click.setZone(row - cur.height, cur.entries);
    });
  }

  /** 收起区(块留在滚动历史里,卡片作答后不抹)。 */
  function hide() { click.clearZone(); cur = null; seq++; }

  /** 收起并抹掉区(菜单确认/关闭:块不留痕)。 */
  function eraseAndHide() { click.clearZone(); erase(); cur = null; seq++; }

  /** 鼠标按下 → 命中区内选项;返回是否消费。 */
  function hit(row) { return click.hit(row); }

  return { show, hide, eraseAndHide, hit };
}

module.exports = { createZone, clipWidth };
