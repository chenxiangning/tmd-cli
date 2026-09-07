/**
 * raw 模式按键读取 —— 交互键(↑↓/Esc/单字符)、鼠标 SGR 上报、CPR 光标回报分流。
 * stdin 是 PTY 从端时 setRawMode 可用;管道冒烟(非 TTY)自动退化行模式。
 * 解析:\x1b[<b;x;yM 鼠标;\x1b[r;cR 光标位置回报(CPR,菜单/选项区定位用);
 * \x1b[A/B 上下;孤立 \x1b = Esc;\r 提交行;可打印字符入行缓冲 + 即时 onChar。
 * 交互键不动行缓冲:菜单收起时 dropLine 统一清(防 Esc 误确认/半行漏进正文)。
 */

function createKeyReader(stdin, { onLine, onKey, onChar, onMouse, onWheel, onCpr }) {
  let raw = false;
  try { stdin.setRawMode(true); stdin.resume(); raw = true; } catch { /* 管道环境 */ }
  let line = "";

  function commit() {
    const s = line;
    line = "";
    onLine(s);
  }

  /** 从 i 处收 CSI 参数体(已确认 \x1b[),返回终止符与参数串;终止符非字母/~ 时弃。 */
  function csi(text, i) {
    let j = i;
    while (j < text.length && !/[A-Za-z~]/.test(text[j])) j++;
    return { params: text.slice(i, j), term: text[j] || "", end: j };
  }

  function feed(chunk) {
    const text = chunk.toString("utf8");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== "\x1b") {
        if (c === "\r" || c === "\n") { commit(); continue; }
        if (c === "\x7f" || c === "\b") { line = line.slice(0, -1); continue; }
        if (c === "\t" || c < " ") continue; /* 控制字符一律不吃 */
        line += c;
        if (onChar) onChar(c);
        continue;
      }
      const next = text[i + 1];
      if (next !== "[" && next !== "O") { onKey("esc"); continue; }
      const { params, term, end } = csi(text, i + 2);
      i = end;
      if (params.startsWith("<")) {
        /* SGR 鼠标:<btn;col;row;btn 0=左键按下,64/65=滚轮上/下;仅消费这些 */
        const m = /^<(\d+);(\d+);(\d+)$/.exec(params);
        if (!m || term !== "M") continue;
        const btn = Number(m[1]);
        if (btn === 0 && onMouse) onMouse(Number(m[3]));
        else if ((btn === 64 || btn === 65) && onWheel) onWheel(Number(m[3]), btn === 64 ? -1 : 1);
      } else if (term === "R" && onCpr) {
        const r = /^(\d+);(\d+)$/.exec(params);
        if (r) onCpr(Number(r[1]));
      } else if (term === "A") onKey("up");
      else if (term === "B") onKey("down");
      else onKey("key");
    }
  }

  if (raw) {
    stdin.on("data", feed);
  } else {
    const readline = require("readline");
    const rl = readline.createInterface({ input: stdin, terminal: false });
    rl.on("line", onLine);
    rl.on("close", () => onKey("close"));
  }

  return {
    /** 交互区收起时丢弃已累积的半行(避免数字直达残留进正文)。 */
    dropLine() { line = ""; },
    close() { if (raw) { commit(); try { stdin.setRawMode(false); } catch { /* noop */ } stdin.pause(); } },
  };
}

module.exports = { createKeyReader };
