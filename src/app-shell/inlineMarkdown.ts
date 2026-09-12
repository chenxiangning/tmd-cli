/**
 * 行内 Markdown 解析 —— 更新记录条目专用。
 *
 * CHANGELOG 条目只用行内语法(`code` / **粗体** / [链接](url),见仓库根
 * CHANGELOG.md 实际用量),为它引入 react-markdown 全管线(files 插件那套含
 * katex/mermaid,刻意按需拆包)不成比例,故自扫三种行内标记:未匹配字符原样,
 * 渲染走 React 节点无 innerHTML 注入面;块级语法不出现在条目行,不支持;嵌套
 * 标记(粗体内套 code 等)按先到先得平铺,不做递归。
 *
 * 不变量:按标记重组 === 原文(解析只做分段换语义,不吞字符),测试守住。
 */

export type InlineSeg =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "link"; value: string; href: string };

/* link 的 href 限 http(s):条目内不会出现其它协议,顺带堵 javascript: 注入。 */
const INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** 行内标记扫描:code / bold / link 三种,未匹配区间为纯文本。 */
export function parseInlineMarkdown(text: string): InlineSeg[] {
  const segs: InlineSeg[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    const i = m.index;
    if (i > last) segs.push({ type: "text", value: text.slice(last, i) });
    if (m[1] !== undefined) segs.push({ type: "code", value: m[1] });
    else if (m[2] !== undefined) segs.push({ type: "bold", value: m[2] });
    else segs.push({ type: "link", value: m[3]!, href: m[4]! });
    last = i + m[0].length;
  }
  if (last < text.length) segs.push({ type: "text", value: text.slice(last) });
  return segs;
}
