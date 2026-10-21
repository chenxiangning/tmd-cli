/**
 * 行命中切段(纯函数,SearchPanel 高亮与测试共用;自组件文件拆出:
 * react-doctor only-export-components——组件文件只导出组件)。
 */

/** 行文本按 query 全部出现切段(大小写跟随开关);纯前端匹配。
 *  长度相等(常规 CJK/拉丁)走 indexOf 快路径;lower 变长字符(İ 等
 *  U+0130 类)会让 hay 索引错位,回退 RegExp 原文索引 —— 索引恒准,
 *  匹配能力退到 JS 简单折叠(2026-10-06 收口旧 ponytail 备注)。 */
export function splitHits(
  text: string,
  query: string,
  caseSensitive: boolean,
): { text: string; hit: boolean }[] {
  if (!query) return [{ text, hit: false }];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  const pushSpan = (from: number, to: number, hit: boolean) => {
    if (to > from) parts.push({ text: text.slice(from, to), hit });
  };
  if (hay.length === text.length) {
    let cursor = 0;
    for (;;) {
      const at = hay.indexOf(needle, cursor);
      if (at === -1) break;
      pushSpan(cursor, at, false);
      pushSpan(at, at + needle.length, true);
      cursor = at + needle.length;
    }
    pushSpan(cursor, text.length, false);
    return parts;
  }
  const re = new RegExp(
    needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    caseSensitive ? "g" : "gi",
  );
  let cursor = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index;
    pushSpan(cursor, at, false);
    pushSpan(at, at + m[0].length, true);
    cursor = at + m[0].length;
  }
  pushSpan(cursor, text.length, false);
  return parts;
}
