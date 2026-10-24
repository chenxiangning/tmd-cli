/**
 * 表格源码复制契约测试 —— tableSource.ts。
 * 覆盖:基本表格(表头+分隔行+行)、管道转义与换行折空格、行内样式反序列化
 * (strong/em/del/code/a/img/br/checkbox)、code span 含管道与反引号的围栏升级、
 * 列数按表头截断/补齐、块级子节点 <br> 连接、空表零输出。
 * DOM 用最小 fake 节点(node 环境无 document,MdTableNode 是结构面,fake 天然满足)。
 */
import { describe, expect, it } from "vitest";
import { tableToMarkdown, type MdTableNode, type MdTableRow } from "./tableSource";

function textNode(value: string): MdTableNode {
  return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] };
}

function el(tag: string, children: MdTableNode[] = [], attrs: Record<string, string> = {}, checked = false): MdTableNode {
  return {
    nodeType: 1,
    nodeName: tag.toUpperCase(),
    textContent: children.map((child) => child.textContent ?? "").join(""),
    childNodes: children,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => (name === "checked" ? checked : name in attrs),
  };
}

const cell = (children: MdTableNode[]): MdTableNode => el("td", children);
const row = (cells: MdTableNode[]): MdTableRow => ({ cells });
const tableOf = (rows: MdTableRow[]) => ({ rows });

describe("tableToMarkdown", () => {
  it("基本表格:表头 + GFM 分隔行 + 体行", () => {
    const markdown = tableToMarkdown(tableOf([
      row([cell([textNode("列A")]), cell([textNode("列B")])]),
      row([cell([textNode("a")]), cell([textNode("b")])]),
    ]));
    expect(markdown).toBe("| 列A | 列B |\n| --- | --- |\n| a | b |\n");
  });

  it("单元格内管道转义、换行折空格", () => {
    const markdown = tableToMarkdown(tableOf([
      row([cell([textNode("a|b")]), cell([textNode("x\ny")])]),
    ]));
    expect(markdown).toBe("| a\\|b | x y |\n| --- | --- |\n");
  });

  it("行内样式反序列化:strong/em/del/a/br/checkbox/img", () => {
    const markdown = tableToMarkdown(tableOf([
      row([
        cell([el("strong", [textNode("粗")]), textNode("与"), el("em", [textNode("斜")])]),
        cell([el("del", [textNode("删")]), el("br"), el("a", [textNode("链")], { href: "https://x.com" })]),
        cell([el("input", [], { type: "checkbox" }, true), textNode("办"), el("img", [], { alt: "图", src: "a.png" })]),
      ]),
    ]));
    expect(markdown).toBe("| **粗**与*斜* | ~~删~~<br>[链](https://x.com) | [x] 办![图](a.png) |\n| --- | --- | --- |\n");
  });

  it("code span:管道照转义;含反引号升长围栏", () => {
    const markdown = tableToMarkdown(tableOf([
      row([cell([el("code", [textNode("x|y")])]), cell([el("code", [textNode("a`b")])])]),
    ]));
    expect(markdown).toBe("| `x\\|y` | ``a`b`` |\n| --- | --- |\n");
  });

  it("列数以表头为准:体行超列截断、缺列补空", () => {
    const markdown = tableToMarkdown(tableOf([
      row([cell([textNode("A")]), cell([textNode("B")])]),
      row([cell([textNode("1")]), cell([textNode("2")]), cell([textNode("3")])]),
      row([cell([textNode("4")])]),
    ]));
    expect(markdown).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 4 |  |\n");
  });

  it("块级子节点间以 <br> 连接;无块级不加", () => {
    const markdown = tableToMarkdown(tableOf([
      row([cell([el("p", [textNode("甲")]), el("p", [textNode("乙")]), textNode("丙")])]),
    ]));
    expect(markdown).toBe("| 甲<br>乙<br>丙 |\n| --- |\n");
  });

  it("空表与空表头零输出", () => {
    expect(tableToMarkdown(tableOf([]))).toBe("");
    expect(tableToMarkdown(tableOf([row([])]))).toBe("");
  });
});
