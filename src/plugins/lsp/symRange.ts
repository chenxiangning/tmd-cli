/**
 * 高亮产物符号区间包裹 —— 把 highlightLine 输出按 UTF-16 偏移 [start, end)
 * 的解码文本包进 <span class="lsp-peek-sym">,符号底色与 token 颜色共存。
 *
 * 纯字符串变换(node 测试免 DOM),依赖 sanitizePrismHtml 的产出契约:
 * 标签只有 `<span class="token …">` / `</span>`,正文经 escapeHtml
 * (&lt; &gt; &quot; &amp; 各记 1 个解码字符)。
 *
 * 边界落在标签内部时走统一的「闭全栈-插标记-原序重开」切分:输出流维护
 * 未闭合标签栈,两处边界(开/闭 sym)都先成对闭掉再重开,保证后续原始
 * 闭标签永远与栈顶配对,Prism 嵌套 token 不产生游离标签。
 */

const SYM_OPEN = '<span class="lsp-peek-sym">';

export function wrapSymRange(html: string, start: number, end: number): string {
  /* 守卫:无效区间原样返回(start<0 只可能来自 trim 校正的防御位)。 */
  if (!Number.isFinite(start) || start < 0 || end <= start) return html;
  let out = "";
  const open: string[] = []; // 输出流当前未闭合标签(开 sym 后栈底为 SYM_OPEN)
  let pos = 0; // 已输出文本的解码位置
  let opened = false;
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const gt = html.indexOf(">", i);
      if (gt < 0) {
        out += html.slice(i); // 残缺标签兜底:剩余原样吐出
        break;
      }
      const tag = html.slice(i, gt + 1);
      out += tag;
      if (tag[1] === "/") open.pop();
      else open.push(tag);
      i = gt + 1;
      continue;
    }
    const lt = html.indexOf("<", i);
    const stop = lt < 0 ? html.length : lt;
    while (i < stop) {
      if (!opened && pos === start) {
        const reopening = open.slice();
        for (let s = open.length; s > 0; s--) out += "</span>";
        open.length = 0;
        out += SYM_OPEN;
        open.push(SYM_OPEN);
        for (const tag of reopening) {
          out += tag;
          open.push(tag);
        }
        opened = true;
      } else if (opened && pos === end) {
        /* 栈底是 SYM_OPEN:slice(1) 即 sym 外层的原始标签,闭栈后原序重开。 */
        const reopening = open.slice(1);
        for (let s = open.length; s > 0; s--) out += "</span>";
        open.length = 0;
        for (const tag of reopening) {
          out += tag;
          open.push(tag);
        }
        opened = false;
      }
      if (html[i] === "&") {
        const semi = html.indexOf(";", i);
        if (semi >= 0 && semi < stop && semi - i <= 6) {
          out += html.slice(i, semi + 1);
          i = semi + 1;
        } else {
          out += html[i];
          i += 1;
        }
      } else {
        out += html[i];
        i += 1;
      }
      pos += 1;
    }
  }
  if (opened) out += "</span>"; // 区间越过文尾:闭悬空 sym(原始标签此时必已配对)
  return out;
}
