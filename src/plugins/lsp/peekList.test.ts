/**
 * peek 引用列表测试 —— buildPeekList 契约清单:
 * 1. 行构建:基名取末段、title 为目录部分、行号后缀 :N;Windows 反斜杠路径先归一再切
 * 2. 初始选中第 0 行且不触发 onSelect;mouseenter 联动选中、click 回调跳转
 * 3. 键盘 ↑↓/Home/End/Enter/Esc:越界收拢;幂等选中不重复回调;Enter 跳当前项;Esc 关闭
 * 4. 行文本回填:唯一文件去重只读一次、前 80 项截断;单文件失败不阻塞;越界行/空白行不回填
 * 5. isConnected 闸:peek 关闭(失连)后旧读弃写
 *
 * node 环境无 DOM:手写最小 FakeEl 覆盖被测代码用到的 DOM 面;ipc.fsReadFile 走 vi.mock。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fileBodies = new Map<string, string>();
const readCalls: string[] = [];

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsReadFile: async (path: string) => {
      readCalls.push(path);
      if (!fileBodies.has(path)) throw new Error("missing");
      return fileBodies.get(path)!;
    },
  },
}));

import { buildPeekList } from "./peekList";
import type { PeekListActions } from "./peekList";
import type { PeekItem } from "./peekWidget";

type Listener = (event: Record<string, unknown>) => void;

/** 最小 fake 元素:只覆盖 buildPeekList 触碰的 DOM 面(classList/子树/事件/isConnected)。 */
class FakeEl {
  children: FakeEl[] = [];
  title = "";
  tabIndex = 0;
  textContent = "";
  isConnected = true;
  private classes = new Set<string>();
  private listeners = new Map<string, Listener[]>();

  get className(): string {
    return [...this.classes].join(" ");
  }
  set className(v: string) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  /* 只解析被测模板 <span class="..."></span>,按 class 顺序建子节点。 */
  set innerHTML(html: string) {
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      const child = new FakeEl();
      child.className = m[1];
      this.children.push(child);
    }
  }
  classList = {
    toggle: (name: string, force?: boolean) => {
      const on = force === undefined ? !this.classes.has(name) : force;
      if (on) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string) => this.classes.has(name),
  };
  setAttribute(_name: string, _value: string) {}
  appendChild(child: FakeEl): FakeEl {
    this.children.push(child);
    return child;
  }
  append(...kids: FakeEl[]) {
    kids.forEach((k) => this.appendChild(k));
  }
  addEventListener(type: string, fn: Listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault: () => {}, ...event });
  }
  querySelector(selector: string): FakeEl | null {
    const cls = selector.slice(1);
    for (const child of this.children) {
      if (child.classes.has(cls)) return child;
      const hit = child.querySelector(selector);
      if (hit) return hit;
    }
    return null;
  }
  scrollIntoView() {}
  focus() {}
}

type Handle = { el: FakeEl; focus(): void };

const makeActions = (): PeekListActions => ({
  onSelect: vi.fn(),
  onJump: vi.fn(),
  onClose: vi.fn(),
});
const item = (path: string, line: number): PeekItem => ({ path, line, startChar: 0, endChar: null });
const build = (items: PeekItem[], a: PeekListActions): Handle =>
  buildPeekList(items, a) as unknown as Handle;
const rowsOf = (handle: Handle) => handle.el.children;
const codeOf = (row: FakeEl) => row.querySelector(".lsp-peek-row-code") as FakeEl;

/* 回填链全部为 Promise 微任务(无真实定时器),固定深度内必然落定,零延迟排空。 */
const drainMicrotasks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.stubGlobal("document", { createElement: () => new FakeEl() });
  fileBodies.clear();
  readCalls.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("行构建", () => {
  it("基名取末段、title 为目录、行号后缀 :N", () => {
    const handle = build([item("/w/src/app.ts", 7)], makeActions());
    const row = rowsOf(handle)[0];
    expect(row.title).toBe("/w/src");
    expect(row.querySelector(".lsp-peek-row-base")!.textContent).toBe("app.ts");
    expect(row.querySelector(".lsp-peek-row-line")!.textContent).toBe(":7");
  });

  it("Windows 反斜杠路径先归一再取基名与目录", () => {
    const handle = build([item("C:\\a\\b.ts", 2)], makeActions());
    const row = rowsOf(handle)[0];
    expect(row.title).toBe("C:/a");
    expect(row.querySelector(".lsp-peek-row-base")!.textContent).toBe("b.ts");
  });

  it("无目录的裸文件名:title 空串、基名原样", () => {
    const handle = build([item("README.md", 1)], makeActions());
    const row = rowsOf(handle)[0];
    expect(row.title).toBe("");
    expect(row.querySelector(".lsp-peek-row-base")!.textContent).toBe("README.md");
  });
});

describe("选中与键盘导航", () => {
  it("初始选中第 0 行且不触发 onSelect", () => {
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1)], makeActions());
    expect(rowsOf(handle)[0].classList.contains("lsp-peek-row-sel")).toBe(true);
    expect(rowsOf(handle)[1].classList.contains("lsp-peek-row-sel")).toBe(false);
  });

  it("ArrowDown/ArrowUp 移动选中、回调 onSelect 并阻止默认滚屏", () => {
    const a = makeActions();
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1), item("/w/c.ts", 1)], a);
    const prevented = vi.fn();
    handle.el.fire("keydown", { key: "ArrowDown", preventDefault: prevented });
    expect(rowsOf(handle)[0].classList.contains("lsp-peek-row-sel")).toBe(false);
    expect(rowsOf(handle)[1].classList.contains("lsp-peek-row-sel")).toBe(true);
    expect(a.onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "/w/b.ts" }), 1);
    handle.el.fire("keydown", { key: "ArrowUp", preventDefault: prevented });
    expect(a.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/w/a.ts" }), 0);
    expect(prevented).toHaveBeenCalledTimes(2);
  });

  it("首行 ↑ 幂等不重复回调;末行 ↓ 收拢在末行", () => {
    const a = makeActions();
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1)], a);
    handle.el.fire("keydown", { key: "ArrowUp" });
    expect(a.onSelect).not.toHaveBeenCalled();
    handle.el.fire("keydown", { key: "End" });
    handle.el.fire("keydown", { key: "ArrowDown" });
    expect(a.onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ path: "/w/b.ts" }), 1);
    expect(rowsOf(handle)[1].classList.contains("lsp-peek-row-sel")).toBe(true);
  });

  it("Home/End 跳首尾行;初始位 Home 幂等不回调", () => {
    const a = makeActions();
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1), item("/w/c.ts", 1)], a);
    handle.el.fire("keydown", { key: "Home" }); // 已在第 0 行:幂等,不触发回调
    expect(a.onSelect).not.toHaveBeenCalled();
    handle.el.fire("keydown", { key: "End" });
    expect(a.onSelect).toHaveBeenLastCalledWith(expect.anything(), 2);
    handle.el.fire("keydown", { key: "Home" });
    expect(a.onSelect).toHaveBeenLastCalledWith(expect.anything(), 0);
  });

  it("Enter 跳转当前选中项;Escape 触发关闭", () => {
    const a = makeActions();
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1)], a);
    handle.el.fire("keydown", { key: "ArrowDown" });
    handle.el.fire("keydown", { key: "Enter" });
    expect(a.onJump).toHaveBeenCalledWith(expect.objectContaining({ path: "/w/b.ts" }));
    handle.el.fire("keydown", { key: "Escape" });
    expect(a.onClose).toHaveBeenCalledTimes(1);
  });

  it("mouseenter 悬停选中对应行;click 回调对应项跳转", () => {
    const a = makeActions();
    const handle = build([item("/w/a.ts", 1), item("/w/b.ts", 1), item("/w/c.ts", 1)], a);
    rowsOf(handle)[2].fire("mouseenter");
    expect(rowsOf(handle)[2].classList.contains("lsp-peek-row-sel")).toBe(true);
    expect(a.onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: "/w/c.ts" }), 2);
    rowsOf(handle)[1].fire("click");
    expect(a.onJump).toHaveBeenCalledWith(expect.objectContaining({ path: "/w/b.ts" }));
  });
});

describe("行文本回填", () => {
  it("同一文件多行引用去重只读一次;命中行 trim 后回填", async () => {
    fileBodies.set("/w/a.ts", "  alpha  \nbeta");
    fileBodies.set("/w/b.ts", "gamma");
    const handle = build(
      [item("/w/a.ts", 1), item("/w/a.ts", 2), item("/w/b.ts", 1)],
      makeActions(),
    );
    await drainMicrotasks();
    expect(readCalls).toEqual(["/w/a.ts", "/w/b.ts"]);
    expect(codeOf(rowsOf(handle)[0]).textContent).toBe("alpha");
    expect(codeOf(rowsOf(handle)[1]).textContent).toBe("beta");
    expect(codeOf(rowsOf(handle)[2]).textContent).toBe("gamma");
  });

  it("回填上限 80:第 81 项不读也不回填", async () => {
    const items = Array.from({ length: 81 }, (_, i) => item(`/w/f${i}.ts`, 1));
    for (const { path } of items) fileBodies.set(path, "code");
    const handle = build(items, makeActions());
    await drainMicrotasks();
    expect(readCalls.length).toBe(80);
    expect(codeOf(rowsOf(handle)[79]).textContent).toBe("code");
    expect(codeOf(rowsOf(handle)[80]).textContent).toBe("");
  });

  it("单文件读取失败不阻塞其余文件回填", async () => {
    fileBodies.set("/w/ok.ts", "fine");
    const handle = build([item("/w/bad.ts", 1), item("/w/ok.ts", 1)], makeActions());
    await drainMicrotasks();
    expect(codeOf(rowsOf(handle)[0]).textContent).toBe("");
    expect(codeOf(rowsOf(handle)[1]).textContent).toBe("fine");
  });

  it("行号越界或整行空白不回填", async () => {
    fileBodies.set("/w/a.ts", "real\n   \n");
    const handle = build([item("/w/a.ts", 99), item("/w/a.ts", 2)], makeActions());
    await drainMicrotasks();
    expect(codeOf(rowsOf(handle)[0]).textContent).toBe("");
    expect(codeOf(rowsOf(handle)[1]).textContent).toBe("");
  });

  it("peek 关闭(失连)后旧读弃写", async () => {
    fileBodies.set("/w/a.ts", "late");
    const handle = build([item("/w/a.ts", 1)], makeActions());
    handle.el.isConnected = false;
    await drainMicrotasks();
    expect(codeOf(rowsOf(handle)[0]).textContent).toBe("");
  });
});
