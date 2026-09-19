/**
 * LSP 位置换算 —— LSP line/character(UTF-16 code unit)↔ 文档偏移。
 *
 * CodeMirror 6 的 Text 偏移同为 UTF-16 code unit(实证:doc.length == js 串长,
 * "a😀b" 行末偏移 4),与 LSP 默认编码同一单位系 —— 换算即纯行算术,
 * 无代理对处理。列越界收拢行尾(防御坏应答)。
 */

/** LSP 位置(0 基行/列;列为 UTF-16 code unit 数)。 */
export interface LspPosition {
  line: number;
  character: number;
}

/** LSP 区间(含头不含尾)。 */
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** LSP 位置 → 偏移;行/列越界收拢到最近合法位置。 */
export function lspToOffset(text: string, pos: LspPosition): number {
  let lineStart = 0;
  for (let i = 0; i < pos.line; i++) {
    const nl = text.indexOf("\n", lineStart);
    if (nl < 0) return text.length;
    lineStart = nl + 1;
  }
  const nl = text.indexOf("\n", lineStart);
  const lineEnd = nl < 0 ? text.length : nl;
  const character = Math.min(Math.max(pos.character, 0), lineEnd - lineStart);
  return lineStart + character;
}

/** 偏移 → LSP 位置。 */
export function offsetToLsp(text: string, offset: number): LspPosition {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  let line = 0;
  for (let nl = before.indexOf("\n"); nl >= 0; nl = before.indexOf("\n", nl + 1)) line++;
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line, character: clamped - lineStart };
}

