/**
 * 快路径事件委托契约测试 —— fastPathDelegation.ts。
 * 覆盖:data-* 路由优先级(代码块复制 > 表格复制 > 图片 > 链接)与未命中零拦截;复制反馈(写
 * 剪贴板、图标切换、1200ms 恢复、重复点击重置、拒绝静默);图片全屏回调与链接三分流、拦截语义
 * 差异(preventDefault/stopPropagation)。DOM 用最小 fake 节点,node 环境零 DOM。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const { openExternalUrl, openFileInTab, copyText } = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  openFileInTab: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("@kernel/ipc", () => ({ openExternalUrl }));
vi.mock("@kernel/fileTabs", () => ({ openFileInTab }));
vi.mock("@kernel/i18n", () => ({ t: (s: string) => s }));
vi.mock("@kernel/clipboard", () => ({ copyText }));

import { CHECK_ICON_SVG, COPY_ICON_SVG } from "./fastPath";
import { fastPathCallbacks, handleFastBlockClick } from "./fastPathDelegation";
import type { MdTableNode, MdTableRow } from "./tableSource";

/* ---------- 最小 fake DOM:只实现委托路径用到的 closest/querySelector/父链 ---------- */

type FakeNode = {
  tag: string;
  attrs: Record<string, string>;
  classes: Set<string>;
  textContent: string;
  innerHTML: string; /* 复制按钮图标切换走 innerHTML 赋值,fake 节点只存串 */
  parent: FakeNode | null;
  children: FakeNode[];
  dataset: Record<string, string>;
  classList: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
  scrollIntoView: Mock; getAttribute: (name: string) => string | null;
  closest: (selector: string) => FakeNode | null;
  querySelector: (selector: string) => FakeNode | null;
  querySelectorAll: (selector: string) => FakeNode[];
};
/** 单个复合选择器(token:tag/.类/[attr])匹配;attr 只断言存在。 */
function matchesToken(n: FakeNode, token: string): boolean {
  const m = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:\.[\w-]+|\[[^\]=]+\])*)$/.exec(token);
  if (!m) return false;
  if (m[1] && n.tag !== m[1]) return false;
  for (const c of m[2].matchAll(/\.([\w-]+)/g)) if (!n.classes.has(c[1])) return false;
  for (const a of m[2].matchAll(/\[([^\]=]+)\]/g)) if (!(a[1] in n.attrs)) return false;
  return true;
}

/** 子孙组合器链匹配(仅 "pre code" 形态):尾 token 匹配自身,余下按序匹配祖先链。 */
function matchesChain(n: FakeNode, tokens: string[]): boolean {
  if (!matchesToken(n, tokens[tokens.length - 1])) return false;
  let idx = tokens.length - 2; let cur = n.parent;
  while (cur && idx >= 0) { if (matchesToken(cur, tokens[idx])) idx -= 1; cur = cur.parent; }
  return idx < 0;
}

function descendants(root: FakeNode): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => n.children.forEach((c) => { out.push(c); walk(c); });
  walk(root); return out;
}

function node(tag: string, attrs: Record<string, string> = {}, text = ""): FakeNode {
  const classes = new Set((attrs.class ?? "").split(/\s+/).filter(Boolean));
  const n: FakeNode = {
    tag, attrs, classes, textContent: text, innerHTML: "",
    parent: null, children: [],
    dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith("data-"))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v])),
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    scrollIntoView: vi.fn(),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    closest(selector) {
      let cur: FakeNode | null = n;
      while (cur) { if (matchesToken(cur, selector)) return cur; cur = cur.parent; }
      return null;
    },
    querySelector(selector) {
      return descendants(n).find((d) => matchesChain(d, selector.split(/\s+/))) ?? null;
    },
    querySelectorAll(selector) {
      const groups = selector.split(",").map((s) => s.trim().split(/\s+/));
      return descendants(n).filter((d) => groups.some((g) => matchesChain(d, g)));
    },
  };
  return n;
}

/** 挂子节点:固定 parent 在前,返回 parent 便于连续挂载。 */
function link(parent: FakeNode, child: FakeNode): FakeNode {
  child.parent = parent; parent.children.push(child); return parent;
}

/** 委托事件:target 为实际点击节点,currentTarget 为监听宿主(.fvp-md-fast)。 */
function clickEvent(target: FakeNode, currentTarget: FakeNode) {
  return { target, currentTarget, stopPropagation: vi.fn(), preventDefault: vi.fn() } as unknown as MouseEvent;
}

/* 复制按钮标准树:host > codeblock > pre > code + button[data-md-copy](初始 Copy 图标) */
function copyTree(codeText = "const x = 1;") {
  const block = node("div", { class: "fvp-file-markdown-codeblock" });
  const pre = node("pre"); link(block, pre);
  const code = node("code", {}, codeText); link(pre, code);
  const button = node("button", { "data-md-copy": "" });
  button.innerHTML = COPY_ICON_SVG; link(block, button);
  return { host: link(node("div", { class: "fvp-md-fast" }), block), button };
}

/** 等已 resolve 的 copyText 微任务链跑完(类切换发生在 .then 里)。 */
function flushMicrotasks() { return Promise.resolve().then(() => Promise.resolve()); }

/* 表格取值用的最小 cell:tableToMarkdown 只消费 childNodes 的文本面 */
const mdCell = (value: string): MdTableNode => ({
  nodeType: 1, nodeName: "TD", textContent: value, childNodes: [{ nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  copyText.mockResolvedValue(undefined);
  fastPathCallbacks.onImageFullscreen = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("handleFastBlockClick 数据路由", () => {
  it("复制按钮命中:写剪贴板取 code 文本,stopPropagation 但不 preventDefault", async () => {
    const { host, button } = copyTree();
    const event = clickEvent(button, host);
    handleFastBlockClick(event);
    expect(copyText).toHaveBeenCalledWith("const x = 1;");
    expect(event.stopPropagation).toHaveBeenCalledTimes(1); expect(event.preventDefault).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(button.classList.contains("is-copied")).toBe(true); expect(button.innerHTML).toBe(CHECK_ICON_SVG);
  });

  it("代码块缺失 code 节点时写入空串(不抛)", () => {
    const block = node("div", { class: "fvp-file-markdown-codeblock" });
    const button = node("button", { "data-md-copy": "" }); link(block, button);
    const host = link(node("div", { class: "fvp-md-fast" }), block);
    handleFastBlockClick(clickEvent(button, host));
    expect(copyText).toHaveBeenCalledWith("");
  });

  it("剪贴板被拒:静默吞错,不进成功反馈", async () => {
    copyText.mockRejectedValue(new Error("denied"));
    const { host, button } = copyTree();
    handleFastBlockClick(clickEvent(button, host));
    await flushMicrotasks();
    expect(button.classList.contains("is-copied")).toBe(false); expect(button.innerHTML).toBe(COPY_ICON_SVG); /* 拒绝路径不动初始图标 */
  });

  it("1200ms 后恢复复制态图标与类;恢复期二次点击重置定时器", async () => {
    const { host, button } = copyTree();
    handleFastBlockClick(clickEvent(button, host));
    await flushMicrotasks();
    vi.advanceTimersByTime(600);
    handleFastBlockClick(clickEvent(button, host)); // 首个定时器须被清掉
    await flushMicrotasks();
    vi.advanceTimersByTime(600); // 距首次点击已满 1200ms
    expect(button.classList.contains("is-copied")).toBe(true); expect(button.innerHTML).toBe(CHECK_ICON_SVG);
    vi.advanceTimersByTime(600); // 距二次点击满 1200ms
    expect(button.classList.contains("is-copied")).toBe(false); expect(button.innerHTML).toBe(COPY_ICON_SVG);
  });

  it("图片命中:onImageFullscreen 收 dataset.src 与 alt;不拦冒泡", () => {
    const onFullscreen = vi.fn();
    fastPathCallbacks.onImageFullscreen = onFullscreen;
    const img = node("img", { "data-md-img": "/ws/a.png", alt: "截图" });
    const host = link(node("div", { class: "fvp-md-fast" }), img);
    const event = clickEvent(img, host);
    handleFastBlockClick(event);
    expect(onFullscreen).toHaveBeenCalledWith({ src: "/ws/a.png", alt: "截图" });
    expect(event.stopPropagation).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("图片无 alt 属性回退 \"image\";回调缺席不抛", () => {
    const onFullscreen = vi.fn();
    fastPathCallbacks.onImageFullscreen = onFullscreen;
    const bare = node("img", { "data-md-img": "b.png" });
    const host = link(node("div", { class: "fvp-md-fast" }), bare);
    handleFastBlockClick(clickEvent(bare, host));
    expect(onFullscreen).toHaveBeenCalledWith({ src: "b.png", alt: "image" });
    fastPathCallbacks.onImageFullscreen = null;
    expect(() => handleFastBlockClick(clickEvent(bare, host))).not.toThrow();
  });

  it("全未命中:零拦截零回调", () => {
    const onFullscreen = vi.fn();
    fastPathCallbacks.onImageFullscreen = onFullscreen;
    const span = node("span", {}, "纯文本");
    const host = link(node("div", { class: "fvp-md-fast" }), span);
    const event = clickEvent(span, host);
    handleFastBlockClick(event);
    expect(event.stopPropagation).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
    expect(copyText).not.toHaveBeenCalled(); expect(openExternalUrl).not.toHaveBeenCalled();
    expect(openFileInTab).not.toHaveBeenCalled(); expect(onFullscreen).not.toHaveBeenCalled();
  });

  it("路由优先级:target 同处复制按钮与链接内,走复制分支不开外链", () => {
    const anchor = node("a", { "data-md-link": "external", href: "https://x.com" });
    const block = node("div", { class: "fvp-file-markdown-codeblock" });
    const pre = node("pre"); link(block, pre); link(pre, node("code", {}, "hi"));
    const button = node("button", { "data-md-copy": "" }); link(block, button);
    link(anchor, block);
    const host = link(node("div", { class: "fvp-md-fast" }), anchor);
    const span = node("span"); link(button, span);
    const event = clickEvent(span, host);
    handleFastBlockClick(event);
    expect(copyText).toHaveBeenCalledWith("hi");
    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("表格复制路由:data-md-table-copy 从表 DOM 现构 GFM 源,反馈同为图标切换", async () => {
    const block = node("div", { class: "fvp-file-markdown-table-block" });
    const table = node("table");
    (table as unknown as { rows: MdTableRow[] }).rows = [
      { cells: [mdCell("列A"), mdCell("列B")] },
      { cells: [mdCell("a"), mdCell("b")] },
    ];
    link(block, table);
    const button = node("button", { "data-md-table-copy": "" });
    button.innerHTML = COPY_ICON_SVG; link(block, button);
    const host = link(node("div", { class: "fvp-md-fast" }), block);
    handleFastBlockClick(clickEvent(button, host));
    expect(copyText).toHaveBeenCalledWith("| 列A | 列B |\n| --- | --- |\n| a | b |\n");
    await flushMicrotasks();
    expect(button.classList.contains("is-copied")).toBe(true); expect(button.innerHTML).toBe(CHECK_ICON_SVG);
  });
});

describe("链接三分流", () => {
  function anchorTree(attrs: Record<string, string>) {
    const anchor = node("a", attrs);
    const host = link(node("div", { class: "fvp-md-fast" }), anchor);
    return { anchor, host };
  }

  it("external:preventDefault+stopPropagation,openExternalUrl 透传 href", () => {
    const { anchor, host } = anchorTree({ "data-md-link": "external", href: "https://a.com/p?x=1" });
    const event = clickEvent(anchor, host);
    handleFastBlockClick(event);
    expect(openExternalUrl).toHaveBeenCalledWith("https://a.com/p?x=1");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("external 的 // 协议相对地址补 https:", () => {
    const { anchor, host } = anchorTree({ "data-md-link": "external", href: "//cdn.b.com/x.js" });
    handleFastBlockClick(clickEvent(anchor, host));
    expect(openExternalUrl).toHaveBeenCalledWith("https://cdn.b.com/x.js");
  });

  it("file:有 data-md-path 开 tab,缺失则不调", () => {
    const withPath = anchorTree({ "data-md-link": "file", "data-md-path": "/ws/proj/a.md" });
    handleFastBlockClick(clickEvent(withPath.anchor, withPath.host));
    expect(openFileInTab).toHaveBeenCalledWith("/ws/proj/a.md");

    openFileInTab.mockClear();
    const noPath = anchorTree({ "data-md-link": "file" });
    const event = clickEvent(noPath.anchor, noPath.host);
    handleFastBlockClick(event);
    expect(openFileInTab).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1); // 默认导航仍被拦
  });

  it("anchor:标题按宽松归一化匹配(URL 解码/小写/去空白标点)后 scrollIntoView", () => {
    const anchor = node("a", { "data-md-link": "anchor", "data-md-anchor": "%E5%AE%89%E8%A3%85%20%E6%AD%A5%E9%AA%A4" });
    const host = link(node("div", { class: "fvp-md-fast" }), anchor);
    const scrollWrap = link(node("div", { class: "fvp-markdown-preview-scroll" }), host);
    const miss = node("h2", {}, "升级步骤!");
    link(scrollWrap, miss);
    const hit = node("h3", {}, "安装 步骤!");
    link(scrollWrap, hit);
    handleFastBlockClick(clickEvent(anchor, host));
    expect(hit.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(miss.scrollIntoView).not.toHaveBeenCalled();
  });

  it("anchor:标题不命中不滚动;容器缺失不抛且默认导航仍被拦", () => {
    const bare = anchorTree({ "data-md-link": "anchor", "data-md-anchor": "nope" });
    const heading = node("h1", {}, "别的标题");
    link(bare.host, heading);
    const event = clickEvent(bare.anchor, bare.host);
    handleFastBlockClick(event);
    expect(heading.scrollIntoView).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    const orphan = anchorTree({ "data-md-link": "anchor", "data-md-anchor": "x" });
    expect(() => handleFastBlockClick(clickEvent(orphan.anchor, orphan.host))).not.toThrow();
  });
});
