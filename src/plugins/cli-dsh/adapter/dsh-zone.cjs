/**
 * 交互区原语 —— 绘制 N 行 + ESC[6n 反推区起点 + 挂鼠标点击区。
 * 供菜单宿主(选模型/强度/模式)与审批/提问卡共用:一个时刻只有一个活动区
 * (菜单只在空闲时开,审批/提问阻塞轮次,天然互斥)。
 * 行宽裁切防换行(换行会让「区起点 + 偏移」错位)。
 *
 * 2026-10-02 三处修复(实测 xterm 6.0.0 无头复现):
 * - clipWidth 的转义序列跳过正则锚错(作用对象已含 ESC 前缀),SGR 被按可见宽
 *   计数 → 窄窗口下交互区整行被吃掉且截断点落进转义序列(见 clipWidth 注释)。
 * - 擦除改「CPR 取当前光标行 → 绝对 CUP+EL」优先:旧的相对上移 height 行在
 *   resize/重排后行号失效,旧块上半截残留。CPR 不可用(管道冒烟)退回相对上移。
 * - CPR 超时(400ms)不再保留上一轮点击区:否则点新块的行会执行上一轮回调
 *   (审批卡上等于点错位置就作答)。
 * 绘制走串行队列:show/hide 交错不会擦一半画一半。
 */

const click = require("./dsh-click.cjs");

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b./g;
/* 单步版:锚在串首,与 ANSI_RE 同一支路集合(截断循环逐 token 消费用)。 */
const ANSI_ONE = /^\x1b\[[0-9;?]*[A-Za-z]|^\x1b\][^\x07]*\x07|^\x1b./;

/* CJK/全角终端占 2 列(与 dsh-render.displayWidth 同表):按字符数算宽会让
   裁切失效 → band 行超宽换行 → 重绘 erase 错位(提问卡叠影实证)。 */
const WIDE_RE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
function plainWidth(s) {
  let w = 0;
  for (const ch of s.replace(ANSI_RE, "")) w += WIDE_RE.test(ch) ? 2 : 1;
  return w;
}

/** 可见宽度裁到终端宽(保留 ANSI 码;CJK 记 2)。
 *  2026-10-02 修复:旧实现把序列跳过正则写成 `/^\[[0-9;?]*[A-Za-z]/`,而作用对象
 *  是 `s.slice(i)`(s[i] 已是 ESC),该分支永不命中 → 只按单字符吞掉 ESC,随后把
 *  SGR 参数体当可见字符计数 → 截断点落进转义序列中间、交互区整行被吃掉,并让
 *  xterm 报 Parsing error。这里统一用 ANSI_ONE(与 plainWidth 同一支路集合)。 */
function clipWidth(print, s) {
  const max = (print.columns && print.columns()) || 100;
  if (plainWidth(s) <= max) return s;
  const limit = Math.max(1, max - 2);
  let out = "", vis = 0, i = 0;
  while (i < s.length) {
    const esc = ANSI_ONE.exec(s.slice(i));
    if (esc) { out += esc[0]; i += esc[0].length; continue; }
    const ch = s[i];
    const w = WIDE_RE.test(ch) ? 2 : 1;
    if (vis + w > limit) break;
    out += ch; vis += w; i++;
  }
  return out + "…\x1b[39m\x1b[49m";
}

/** clickDep 可注入(缺省 = 真鼠标路由件):纯逻辑测试要能确定性地喂 CPR 结果,
 *  vitest 的 ESM/CJS 互操作会让测试里的 import 与这里的 require 拿到两个实例。 */
function createZone(print, clickDep = click) {
  let cur = null;   /* {entries, height, seq}:已排队的当前块 */
  let drawn = 0;    /* 视口里真实画出的行数(擦除用) */
  let seq = 0;
  let cprOk = true; /* 首次 CPR 超时即关:退回相对擦除,不再每帧白等 400ms */
  let chain = Promise.resolve();

  const push = (fn) => { chain = chain.then(fn).catch(() => {}); };

  /** 擦掉视口里已画的 drawn 行(CPR 绝对寻址优先,见文件头)。 */
  async function eraseDrawn() {
    if (drawn <= 0) return;
    const h = drawn;
    drawn = 0;
    if (cprOk) {
      const row = await clickDep.requestCursor();
      if (row != null) { print.write(`\x1b[${Math.max(1, row - h)};1H\x1b[J`); return; }
      cprOk = false;
    }
    print.write(`\x1b[${h}A\x1b[J`);
  }

  /** 绘制/重绘:擦旧块 → 画新行 → CPR 定位挂点击区。 */
  function show(lines, entries) {
    const clipped = lines.map((l) => clipWidth(print, l));
    const mine = ++seq;
    cur = { entries, height: clipped.length, seq: mine };
    push(async () => {
      if (!cur || cur.seq !== mine) return; /* 期间被替换/关闭 */
      await eraseDrawn();
      if (!cur || cur.seq !== mine) return;
      for (const l of clipped) print.print(l);
      drawn = clipped.length;
      if (!cprOk) { clickDep.clearZone(); return; } /* 终端不支持 CPR:退回纯键盘 */
      const row = await clickDep.requestCursor();
      if (row == null) { cprOk = false; clickDep.clearZone(); return; }
      if (!cur || cur.seq !== mine) return;
      clickDep.setZone(row - drawn, cur.entries);
    });
  }

  /** 收起区(块留在滚动历史里,卡片作答后不抹)。 */
  function hide() { clickDep.clearZone(); cur = null; seq++; }

  /** 收起并抹掉区(菜单确认/关闭:块不留痕)。 */
  function eraseAndHide() {
    const mine = ++seq;
    cur = null;
    clickDep.clearZone();
    push(async () => { if (mine === seq) await eraseDrawn(); });
  }

  /** 终端改尺寸:点击区行号立即作废(下次 show 用 CPR 重新定位旧块再擦)。 */
  function onResize() { clickDep.clearZone(); }

  /** 鼠标按下 → 命中区内选项;返回是否消费。 */
  function hit(row) { return clickDep.hit(row); }

  return { show, hide, eraseAndHide, onResize, hit };
}

module.exports = { createZone, clipWidth };
