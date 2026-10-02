/**
 * 底栏行单一所有权 —— 状态行(spinner / idle footer)钉在视口最后一行。
 * 机制:scroll region 收缩到 1..n-1(DECSTBM),内容滚动只发生在区内,
 * 第 n 行是底栏专属行,永不进 scrollback,也永不被内容光标触及 ——
 * 因此底栏无条件常画:流式正文输出中 spinner 也不消失(「loading 不稳/
 * 一会有一会没」根治)。幕布是字节流,「固定在底部」只有 region 一条路。
 *
 * 光标纪律(2026-10-02 实证修复,本文件的核心不变量):
 * - DECSTBM 会把光标搬到 home(实测 xterm:6 行终端光标在 (5,0) 时执行
 *   `\x1b[1;5r` 后光标回到 (0,0))。因此**设区必须与存还原同层**:存一次
 *   (`\x1b7`)→ 设区/绝对寻址/擦写 → 还一次(`\x1b8`)。旧实现先存光标、
 *   再在里层又存一次并只还一次,还原落在 home,后续正文从第 1 行开始写,
 *   覆盖历史头部并把整屏搅乱;这些坏字节同时被 PTY 日志录下,重开会话
 *   原样复现(「实时幕布 + 重开都乱」同一根因)。
 * - `arm()` 在出任何内容之前把区钉好:此后内容光标由终端保证留在 1..n-1
 *   (区内写满即区内滚动),存还原永远回到合法位置。若等到正文已铺满整屏
 *   才首次设区,内容光标会停在底栏行(实测:还原到 (5,0) 后写字符落在第 6
 *   行=底栏行),底栏与正文互相覆盖。
 * - 底栏一律关自动换行(DECAWM `\x1b[?7l` … `\x1b[?7h`)后写:PTY 列数
 *   (`process.stdout.columns`)与幕布真实列数在拖拽/隐藏期可能短暂不一致
 *   (实测日志出现过 1/17 列钳制),开换行会把底栏折到下一行并滚动整区 =
 *   残段刷屏,且同样被日志录下来重开复现。配合 `fitWidth` 双保险。
 * - 非 tty(rows<2)不设 region 不画底栏,内容裸流(管道冒烟)。
 */

const { fitWidth } = require("./dsh-render.cjs");

function createStream(rawWrite, cols, rows) {
  let status = "";      // 底栏文本(不含换行)
  let dangling = false; // 有流式内容行未收尾(光标在非零列)
  let pinned = 0;       // 已设 region 的终端行数(0=未设;非 tty 恒 0)

  const nRows = () => (typeof rows === "function" ? rows() : 0) | 0;
  const nCols = () => (typeof cols === "function" ? cols() : 100) | 0;
  /* 底栏写宽上限:截到 cols-2,再留 1 列余量给自动换行的临界列。 */
  const statusWidth = () => Math.max(1, nCols() - 1);

  /** 同名保存/还原包裹:所有会搬光标的动作都必须包在里面(见文件头光标纪律)。 */
  const withSavedCursor = (body) => {
    rawWrite("\x1b7");
    body();
    rawWrite("\x1b8");
  };
  /** 擦某一行(绝对寻址;调用方负责包存还原)。 */
  const wipeRow = (row) => rawWrite(`\x1b[${row};1H\x1b[2K`);
  /** 钉区:region 1..n-1(n = 当前行数)。已是该值则不重发。 */
  const pin = () => {
    const n = nRows();
    if (n < 2) return;
    if (n === pinned) return;
    rawWrite(`\x1b[1;${n - 1}r`);
    pinned = n;
  };
  /** 画底栏文本:关自动换行写第 n 行(调用方负责钉区与存还原)。 */
  const paintRow = () => {
    const n = nRows();
    if (n < 2) return;
    rawWrite(`\x1b[?7l\x1b[${n};1H\x1b[2K` + fitWidth(status, statusWidth()) + `\x1b[?7h`);
  };
  /* 擦第 n 行(绝对寻址,存还原光标;未钉或非 tty 不动)。 */
  const wipe = () => {
    if (!pinned) return;
    withSavedCursor(() => wipeRow(pinned));
  };
  /* 底栏无条件常画:绝对寻址不碰内容光标,流式正文中 spinner 也不消失。 */
  const paint = () => {
    if (!status) return;
    if (nRows() < 2) return; /* 非 tty / 矮终端:不画状态行 */
    withSavedCursor(() => { pin(); paintRow(); });
  };

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
    /** 出内容前先钉区(见文件头):此后内容光标由终端保证留在区内。 */
    arm() {
      const n = nRows();
      if (n < 2 || n === pinned) return;
      withSavedCursor(() => pin());
    },
    /** 终端改尺寸:旧行位置的底栏擦掉,按新行数重钉重画。 */
    resize() {
      const old = pinned;
      pinned = 0; /* 行数可能已变:强制 pin 重发 region */
      withSavedCursor(() => {
        if (old) wipeRow(old);
        pin();
        if (status) paintRow();
      });
    },
    /** 退出前复位 region(不留缩区给复用的 xterm)。 */
    reset() {
      wipe();
      /* DECSTBM 会把光标搬到 home,复位 region 同样要包在存还原里 ——
         否则退出后光标停在 (0,0),复用幕布的下一条输出覆盖历史首行。 */
      if (pinned) withSavedCursor(() => rawWrite("\x1b[0r"));
      pinned = 0;
      status = "";
    },
  };
}

module.exports = { createStream };
