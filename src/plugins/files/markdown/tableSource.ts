/**
 * 表格源码复制 —— 从渲染后的 DOM 表格重建 GFM markdown 源。
 *
 * 富路径(FileMarkdownTableBlock)与快路径(fastPath table 规则)产出的
 * <table> 结构同构,复制时统一走本函数,无需把块源文透传进两条渲染管线。
 * 行内样式按 GFM 反序列化(strong/em/del/code/a/img/br/checkbox),块级子节点
 * 间以 <br> 连接;单元格内 `|` 一律转义防破列。接口取最小结构面(ArrayLike +
 * nodeType/nodeName),真实 DOM 与测试 fake 树都天然满足。
 */

/** 最小节点面:真实 DOM Node/Element 结构性满足,测试用 fake 树同构。 */
export interface MdTableNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MdTableNode>;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
}

export interface MdTableRow {
  cells: ArrayLike<MdTableNode>;
}

/** 最小表面:HTMLTableElement( rows/cells 均为 ArrayLike)结构性满足。 */
export interface MdTableSource {
  rows: ArrayLike<MdTableRow>;
}

const TEXT_NODE = 3;
const BLOCK_TAGS = new Set(["p", "div", "ul", "ol", "pre", "blockquote", "li"]);

/** 表格复制主入口:首行为表头,列数以表头为准,表头后补 GFM 分隔行。 */
export function tableToMarkdown(table: MdTableSource): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) {
    return "";
  }
  const columnCount = rows[0].cells.length;
  if (columnCount === 0) {
    return "";
  }
  const lines = rows.map((row) => rowToLine(row, columnCount));
  lines.splice(1, 0, `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`);
  return `${lines.join("\n")}\n`;
}

function rowToLine(row: MdTableRow, columnCount: number): string {
  const cells = Array.from(row.cells).slice(0, columnCount);
  while (cells.length < columnCount) {
    cells.push({ nodeType: 1, nodeName: "td", textContent: "", childNodes: [] });
  }
  return `| ${cells.map((cell) => serializeChildren(cell)).join(" | ")} |`;
}

function serializeChildren(node: MdTableNode): string {
  const parts = Array.from(node.childNodes).map((child) => ({
    block: child.nodeType !== TEXT_NODE && BLOCK_TAGS.has(child.nodeName.toLowerCase()),
    markdown: serializeNode(child),
  })).filter((part) => part.markdown !== "");
  return parts
    .map((part, index) => part.markdown + (part.block && index < parts.length - 1 ? "<br>" : ""))
    .join("");
}

function serializeNode(node: MdTableNode): string {
  if (node.nodeType === TEXT_NODE) {
    return (node.textContent ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  }
  const tag = node.nodeName.toLowerCase();
  switch (tag) {
    case "br":
      return "<br>";
    case "strong":
    case "b":
      return `**${serializeChildren(node)}**`;
    case "em":
    case "i":
      return `*${serializeChildren(node)}*`;
    case "del":
    case "s":
      return `~~${serializeChildren(node)}~~`;
    case "code":
      return codeSpan(node.textContent ?? "");
    case "a":
      return `[${serializeChildren(node)}](${node.getAttribute?.("href") ?? ""})`;
    case "img":
      return `![${node.getAttribute?.("alt") ?? ""}](${node.getAttribute?.("src") ?? ""})`;
    case "input":
      return node.getAttribute?.("type") === "checkbox"
        ? (node.hasAttribute?.("checked") ? "[x] " : "[ ] ")
        : "";
    default:
      return serializeChildren(node);
  }
}

/** 行内 code:管道照转义(GFM 表格内 `\|` 渲染回 `|`),含反引号时升长围栏。 */
function codeSpan(text: string): string {
  const escaped = text.replace(/\|/g, "\\|");
  if (!escaped.includes("`")) {
    return `\`${escaped}\``;
  }
  const longestRun = (escaped.match(/`+/g) ?? []).reduce((a, b) => (b.length > a.length ? b : a), "");
  const fence = "`".repeat(Math.max(2, longestRun.length + 1));
  const pad = escaped.startsWith("`") || escaped.endsWith("`") ? " " : "";
  return `${fence}${pad}${escaped}${pad}${fence}`;
}
