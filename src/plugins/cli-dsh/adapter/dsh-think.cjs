/**
 * 思考标签剥离器 —— 实证:MiniMax-M3 在工具步之间把 `</mm:think>` 等思考标签
 * 当正文吐出(截图 `</mm:think></mm:think>Now I have...` 泄漏进正文)。
 * 有状态流式过滤:跨 chunk 缓冲,吞掉完整标签(名含 think 的任意标签 + 常见
 * 变体),正文原样透出;flush 时把未成标签的残段吐出防吞正文。
 */

/* 完整标签正则:开/闭 + 名含 think/thinking/reason(大小写不敏感)。 */
const TAG_RE = /<\/?\s*(?:think|thinking|reason(?:ing)?|mm:think(?:ing)?|antml:think(?:ing)?)\b[^>]*>/gi;

function createThinkStripper() {
  let buf = "";
  return {
    feed(text) {
      buf += text;
      buf = buf.replace(TAG_RE, "");
      /* 末尾疑似半截标签(以 "<" + 字母/斜杠 起头且无 ">"):暂扣等下一 chunk。
         普通 "a < b" 不扣(不匹配 "<[a-zA-Z/]")。 */
      const m = /<[/a-zA-Z][^>]*$/.exec(buf);
      if (m) {
        const out = buf.slice(0, m.index);
        buf = m[0];
        return out;
      }
      const held = buf;
      buf = "";
      return held;
    },
    /** 轮次结束:吐出缓冲残段(正常为空;半截标签按字面透出防吞正文)。 */
    flush() {
      const rest = buf.replace(TAG_RE, "");
      buf = "";
      return rest;
    },
  };
}

module.exports = { createThinkStripper };
