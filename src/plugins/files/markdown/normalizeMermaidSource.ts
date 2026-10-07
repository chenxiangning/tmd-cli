/**
 * Mermaid 源码归一化 —— 照抄 codemoss normalizeMermaidSource.ts。
 *
 * flowchart 未加引号的节点标签含括号时 lexer 会抛 PS token 错误。
 * LLM 生成的图几乎不给含 `(...)`、`<br/>` 的标签加引号。
 * 只给需要的长方形 `[...]`/菱形 `{...}` 节点标签与 `|...|` 边标签补引号
 * (边标签含裸 `()[]{}` 同样被拒;`<>` 无害,2026-10-07 实证),不改写其它形状:
 * - cylinder `id[(...)]`、circle `id((...))`、stadium `id([...])`、
 *   subroutine `id[[...]]`、hexagon `id{{...}}`、parallelogram `id[/.../]` 等
 * - 已加引号的 `id["..."]` / `id['...']`
 */

const FLOWCHART_HEADER_RE = /^(?:flowchart|graph)(?:\s|$)/im;

/** 会破坏未加引号方形/菱形标签的字符或模式。 */
const LABEL_NEEDS_QUOTE_RE = /[()<>]|<br\s*\/?>/i;

function escapeMermaidQuotedLabel(label: string): string {
  // Mermaid entity 形式可在 "..." 标签内安全嵌套双引号。
  return label.replace(/"/g, "#quot;");
}

function labelNeedsQuote(label: string): boolean {
  if (!label) {
    return false;
  }
  return LABEL_NEEDS_QUOTE_RE.test(label);
}

function maybeQuoteRectLabel(id: string, label: string): string {
  if (!labelNeedsQuote(label)) {
    return `${id}[${label}]`;
  }
  return `${id}["${escapeMermaidQuotedLabel(label)}"]`;
}

function maybeQuoteDiamondLabel(id: string, label: string): string {
  if (!labelNeedsQuote(label)) {
    return `${id}{${label}}`;
  }
  return `${id}{"${escapeMermaidQuotedLabel(label)}"}`;
}

/** 会破坏未加引号边标签的字符(<> 无害,实证同上)。 */
const EDGE_LABEL_NEEDS_QUOTE_RE = /[(){}[\]]/;

function isQuotedLabel(label: string): boolean {
  return (
    (label.startsWith('"') && label.endsWith('"')) ||
    (label.startsWith("'") && label.endsWith("'"))
  );
}

function maybeQuoteEdgeLabel(label: string): string {
  if (!EDGE_LABEL_NEEDS_QUOTE_RE.test(label) || isQuotedLabel(label)) {
    return `|${label}|`;
  }
  return `|"${escapeMermaidQuotedLabel(label)}"|`;
}

/**
 * 遍历 flowchart 源码,给不安全的节点标签(长方形/菱形)与边标签补引号。
 * 只对 flowchart/graph 图生效;其它图类型原样返回。
 */
export function normalizeMermaidSource(source: string): string {
  if (!source || !FLOWCHART_HEADER_RE.test(source)) {
    return source;
  }

  let result = "";
  let i = 0;
  const len = source.length;

  while (i < len) {
    // 边标签 |...|:节点标签内的 | 已被节点分支整段消费,漏到这里的才按边标签处理。
    // 无闭合 | 或标签跨行(长文本链/注释错位可能误配)原样放行:漏补比错改安全。
    if (source[i] === "|") {
      const close = source.indexOf("|", i + 1);
      const label = close === -1 ? null : source.slice(i + 1, close);
      if (label === null || label.includes("\n")) {
        result += source[i];
        i += 1;
      } else {
        result += maybeQuoteEdgeLabel(label);
        i = close + 1;
      }
      continue;
    }
    const idStart = i;
    if (/[A-Za-z_]/.test(source[i] ?? "")) {
      let j = i + 1;
      while (j < len && /[\w-]/.test(source[j] ?? "")) {
        j += 1;
      }
      const prev = idStart > 0 ? source[idStart - 1] : "";
      const id = source.slice(idStart, j);
      const next = source[j];

      if (prev && /[\w-]/.test(prev)) {
        result += source[i];
        i += 1;
        continue;
      }

      // 长方形: id[label] — 跳过 [ 后紧跟特殊字符的形状
      if (next === "[") {
        const afterOpen = source[j + 1];
        if (
          afterOpen === "(" ||
          afterOpen === "[" ||
          afterOpen === '"' ||
          afterOpen === "'" ||
          afterOpen === "/" ||
          afterOpen === "\\"
        ) {
          result += id;
          i = j;
          continue;
        }
        const close = source.indexOf("]", j + 1);
        if (close === -1) {
          result += id;
          i = j;
          continue;
        }
        const label = source.slice(j + 1, close);
        result += maybeQuoteRectLabel(id, label);
        i = close + 1;
        continue;
      }

      // 菱形: id{label} — 跳过 hexagon {{ 与已加引号
      if (next === "{") {
        const afterOpen = source[j + 1];
        if (
          afterOpen === "{" ||
          afterOpen === '"' ||
          afterOpen === "'"
        ) {
          result += id;
          i = j;
          continue;
        }
        const close = source.indexOf("}", j + 1);
        if (close === -1) {
          result += id;
          i = j;
          continue;
        }
        const label = source.slice(j + 1, close);
        result += maybeQuoteDiamondLabel(id, label);
        i = close + 1;
        continue;
      }

      result += id;
      i = j;
      continue;
    }

    result += source[i];
    i += 1;
  }

  return result;
}
