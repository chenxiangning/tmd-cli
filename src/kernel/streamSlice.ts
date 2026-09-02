/**
 * PTY 字节流尾部截断 —— 在“安全边界”下刀，保证 xterm 回放时拿到的是可解析流。
 *
 * 背景：输出环形缓冲超限后若从任意位置 slice，截断点可能落在
 * ESC 与序列 final byte 之间（`\x1b[38;2;…m` 被切成 `[38;2;…m`），
 * 回放时残片被 xterm 当普通文本画出来 —— 幕布顶部出现 `[38;2;107;114;128m` 这类乱码。
 *
 * 策略：从截断点反向找最近的 ESC，解析该序列是否完整跨过截断点；
 * 被拦腰切断就把下刀点退到该 ESC（保留完整序列，宁可多留不少截）。
 * 另防 UTF-16 surrogate pair 被劈开（emoji 等）。
 */

const ESC = "\x1b";

/** 返回从 esc 开始的转义序列的结束下标(不含)；序列延伸到缓冲末尾(不完整)返回 -1。 */
function sequenceEnd(s: string, esc: number): number {
  const kind = s.charCodeAt(esc + 1);
  if (Number.isNaN(kind)) return -1; // 落单 ESC
  if (kind === 0x5b) {
    /* '[' CSI：参数/中间字节之后以 0x40–0x7E 的 final byte 收尾 */
    for (let i = esc + 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i + 1;
    }
    return -1;
  }
  if (kind === 0x5d) {
    /* ']' OSC(超链接/窗口标题等,可长达数百字符)：以 BEL 或 ESC\ 收尾 */
    for (let i = esc + 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x07) return i + 1;
      if (c === 0x1b && s.charCodeAt(i + 1) === 0x5c) return i + 2;
    }
    return -1;
  }
  if (kind === 0x50) {
    /* 'P' DCS(tmux passthrough 等,payload 可远超 3 字节)：与 OSC 同以 ESC\ 收尾
       (BEL 不合法)。扫描到末尾未闭合 → -1,由调用方退到该 ESC。 */
    for (let i = esc + 2; i < s.length; i++) {
      if (s.charCodeAt(i) === 0x1b && s.charCodeAt(i + 1) === 0x5c) return i + 2;
    }
    return -1;
  }
  /* 其余转义(字符集选择等)至多 3 字节;宁可保守视为更长 */
  return esc + 3;
}

export function sliceStreamTail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let start = text.length - limit;

  /* 截断点若落在某个未完结的转义序列中间 → 退到该序列的 ESC 处下刀 */
  const esc = text.lastIndexOf(ESC, start);
  if (esc !== -1) {
    const end = sequenceEnd(text, esc);
    if (end === -1 || end > start) start = esc;
  }

  /* 切在 low surrogate 上说明把 emoji 劈成两半，后移一位让高位对齐 */
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) start += 1;

  return text.slice(start);
}
