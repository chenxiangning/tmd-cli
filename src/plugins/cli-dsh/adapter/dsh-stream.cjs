/**
 * 底栏行单一所有权 —— 状态行(spinner / idle footer)钉在视口最后一行。
 * 机制:scroll region 收缩到 1..n-1(DECSTBM),内容滚动只发生在区内,
 * 第 n 行是底栏专属行,永不进 scrollback,也永不被内容光标触及 ——
 * 因此底栏无条件常画:流式正文输出中 spinner 也不消失(「loading 不稳/
 * 一会有一会没」根治)。幕布是字节流,「固定在底部」只有 region 一条路。
 * 绘制一律绝对寻址(DECSC 存光标 → CUP 第 n 行 → EL 擧行 → 写 → DECRC
 * 还原),不依赖记账;zone/menu 的相对寻址重绘永远够不到第 n 行。
 * - footer 超终端宽会换行残段刷屏 → paint 一律 fitWidth 截到 cols-1。
 * - 非 tty(rows<2)不设 region 不画底栏,内容裸流(管道冒烟)。
 */

const { fitWidth } = require("./dsh-render.cjs");

function createStream(rawWrite, cols, rows) {
  let status = "";      // 底栏文本(不含换行)
  let dangling = false; // 有流式内容行未收尾(光标在非零列)
  let pinned = 0;       // 已设 region 的终端行数(0=未设;非 tty 恒 0)

  const nRows = () => (typeof rows === "function" ? rows() : 0) | 0;
  /* 擦第 n 行(绝对寻址,存还原光标;未钉或非 tty 不动)。 */
  const wipe = () => {
    if (!pinned) return;
    rawWrite(`\x1b7\x1b[${pinned};1H\x1b[2K\x1b8`);
  };
  /* 底栏无条件常画:绝对寻址不碰内容光标,流式正文中 spinner 也不消失。 */
  const paint = () => {
    if (!status) return;
    const n = nRows();
    if (n < 2) return; /* 非 tty / 矮终端:不画状态行 */
    if (n !== pinned) {
      rawWrite(`\x1b7\x1b[1;${n - 1}r`); /* 存光标再设 region:DECSTBM 会归位光标 */
      pinned = n;
    }
    rawWrite(`\x1b7\x1b[${n};1H\x1b[2K` + fitWidth(status, nCols() - 1) + `\x1b8`);
  };
  const nCols = () => (typeof cols === "function" ? cols() : 100);

  /** 完整内容行:写(补 \n)。底栏行受 region 保护,内容不触第 n 行,无需擦。 */
  function line(text) {
    rawWrite(text.endsWith("\n") ? text : text + "\n");
    dangling = false;
  }

  return {
    /* ── 底栏所有权 ── */
    setStatus(s) { status = s; if (!s) { wipe(); return; } paint(); },
    chunk(text) { rawWrite(text); dangling = !text.endsWith("\n"); },
    endLine() { if (dangling) { rawWrite("\n"); dangling = false; } },
    write: (s) => rawWrite(s),
    print: line,
    nl: () => line(""),
    columns: nCols,
    /** 终端改尺寸:旧行位置的底栏擦掉,按新行数重钉重画。 */
    resize() {
      if (!pinned) { paint(); return; }
      const old = pinned;
      pinned = 0;
      rawWrite(`\x1b7\x1b[${old};1H\x1b[2K\x1b8`);
      paint();
    },
    /** 退出前复位 region(不留缩区给复用的 xterm)。 */
    reset() {
      wipe();
      if (pinned) rawWrite("\x1b[0r");
      pinned = 0;
      status = "";
    },
  };
}


module.exports = { createStream };
