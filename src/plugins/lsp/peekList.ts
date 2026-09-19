/**
 * peek 引用列表 —— 行构建(基名:行号 + 行文本回填,目录退 title)+ 键盘导航
 *(↑↓/Home/End/Enter/Esc)+ 选中/hover 联动预览。行文本按唯一文件去重读,
 * 前 80 项回填;isConnected 闸防 peek 关闭后旧写。自 peekWidget 拆出(文件规模铁则)。
 */

import { ipc } from "@kernel/ipc";
import { normalizePath } from "@kernel/pathUtils";
import type { PeekItem } from "./peekWidget";

export interface PeekListActions {
  /** 选中变化(键盘/hover)联动预览。 */
  onSelect: (item: PeekItem, index: number) => void;
  /** Enter/点击跳转。 */
  onJump: (item: PeekItem) => void;
  /** Esc 关闭(回焦编辑器)。 */
  onClose: () => void;
}

export interface PeekListHandle {
  el: HTMLDivElement;
  focus(): void;
}

/** 行文本回填上限(防大引用集 IO 风暴)。 */
const LINE_TEXT_CAP = 80;

export function buildPeekList(items: readonly PeekItem[], actions: PeekListActions): PeekListHandle {
  const el = document.createElement("div");
  el.className = "lsp-peek-list";
  el.tabIndex = -1;
  el.setAttribute("role", "listbox");

  let selected = 0;
  const rows: HTMLDivElement[] = [];

  const paintSelection = () =>
    rows.forEach((row, i) => row.classList.toggle("lsp-peek-row-sel", i === selected));
  const select = (index: number) => {
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    if (clamped === selected && rows[clamped]?.classList.contains("lsp-peek-row-sel")) return;
    selected = clamped;
    paintSelection();
    rows[selected]?.scrollIntoView({ block: "nearest" });
    actions.onSelect(items[selected], selected);
  };

  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "lsp-peek-row";
    row.setAttribute("role", "option");
    const norm = normalizePath(item.path);
    const slash = norm.lastIndexOf("/");
    const base = slash < 0 ? norm : norm.slice(slash + 1);
    row.title = slash < 0 ? "" : norm.slice(0, slash);
    const name = document.createElement("div");
    name.className = "lsp-peek-row-name";
    name.innerHTML = `<span class="lsp-peek-row-base"></span><span class="lsp-peek-row-line"></span>`;
    (name.querySelector(".lsp-peek-row-base") as HTMLElement).textContent = base;
    (name.querySelector(".lsp-peek-row-line") as HTMLElement).textContent = `:${item.line}`;
    const code = document.createElement("div");
    code.className = "lsp-peek-row-code";
    row.append(name, code);
    row.addEventListener("mouseenter", () => select(index));
    row.addEventListener("click", () => actions.onJump(items[index]));
    el.appendChild(row);
    rows.push(row);
  });
  paintSelection();

  /* 行文本回填:唯一文件去重读一次,前 80 项;peek 关闭(el 失连)即弃写。 */
  const capped = items.slice(0, LINE_TEXT_CAP);
  const uniquePaths = [...new Set(capped.map((item) => normalizePath(item.path)))];
  void Promise.all(
    uniquePaths.map(async (path) => {
      try {
        return (await ipc.fsReadFile(path)).split("\n");
      } catch {
        return null; // 单文件读取失败不阻塞其余
      }
    }),
  ).then((results) => {
    if (!el.isConnected) return;
    uniquePaths.forEach((path, i) => {
      const lines = results[i];
      if (!lines) return;
      capped.forEach((item, index) => {
        if (normalizePath(item.path) !== path) return;
        const text = lines[item.line - 1]?.trim();
        const codeEl = rows[index]?.querySelector(".lsp-peek-row-code");
        if (codeEl && text) codeEl.textContent = text;
      });
    });
  });

  el.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(items.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      actions.onJump(items[selected]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      actions.onClose();
    }
  });

  return { el, focus: () => el.focus() };
}
