/**
 * 终端搜索命中计数(n/m)—— 自 terminalSearch.tsx 拆出的纯函数(组件不携带计算)。
 * 口径与 xterm SearchAddon 对齐:逐行扫描(跨行不命中)、caseSensitive/regex 选项;
 * 当前序号 = 选区起点之前的命中数 + 1(findNext/findPrevious 落选区,addon 无序号 API,
 * 从选区反推 —— 口径钉死在此)。零长命中(a* 类正则)不计:与可视高亮对齐无意义。
 * ponytail: 全缓冲逐行扫描 O(行数),5 万行回滚内毫秒级;逐键触发不防抖,卡顿再议。
 */

export interface TerminalMatchCountOpts {
  caseSensitive: boolean;
  regex: boolean;
}

/** 命中位置(行,列):列 = 行内字符偏移。 */
export interface TerminalMatchPos {
  row: number;
  col: number;
}

/** 正则编译;非法 pattern 返回 null(调用方按 0 命中展示,find 静默跳过)。 */
function compileMatcher(query: string, opts: TerminalMatchCountOpts): RegExp | null {
  const source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source, opts.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/**
 * 统计命中:total = 全缓冲命中数;current = 选区起点所在命中序号(1 基,
 * 无选区 = 0)。anchor = 选区起点(getSelectionPosition().start)。
 */
export function countTerminalMatches(
  lines: readonly string[],
  query: string,
  opts: TerminalMatchCountOpts,
  anchor?: TerminalMatchPos | null,
): { total: number; current: number } {
  if (!query) return { total: 0, current: 0 };
  const re = compileMatcher(query, opts);
  if (!re) return { total: 0, current: 0 };
  let total = 0;
  let before = 0;
  for (let row = 0; row < lines.length; row++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[row] as string)) !== null) {
      if (m[0].length === 0) {
        /* 零长命中防死循环(matchAll 不前移):跳过并手动推进。 */
        re.lastIndex += 1;
        continue;
      }
      total++;
      if (anchor && (row < anchor.row || (row === anchor.row && m.index < anchor.col))) before++;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return { total, current: anchor && total > 0 ? Math.min(before + 1, total) : 0 };
}
