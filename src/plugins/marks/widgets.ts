/**
 * marks 行间批注 widget —— NoteWidget(折叠摘要条 / 展开批注卡)与
 * AddMarkWidget(选区浮「⚑ 标记」钮)。自 editorExtension.ts 拆出(文件规模铁则)。
 *
 * 拆包红线:对 @codemirror/* 只 type-only;WidgetType 是运行期 extends 的值,
 * 经 createMarkWidgets 参数注入(editorExtension 工厂动态 import 后传入),
 * 本模块零 CM 静态依赖。
 */

import type { EditorView, WidgetType } from "@codemirror/view";
import { getActiveWorkspace } from "@kernel/workspace";
import type { MarkState } from "./anchor";
import {
  addMark,
  removeMark,
  setMarkState,
  toggleExpanded,
  updateNote,
} from "./store";

export interface MarkRuntime {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  state: MarkState;
  note: string;
  excerpt: string;
  expanded: boolean;
}

export const STATE_COLOR: Record<MarkState, string> = {
  pending: "var(--tmd-warn)",
  staged: "var(--tmd-warn)",
  sent: "var(--tmd-accent)",
  drifted: "var(--tmd-warn)",
  lost: "var(--tmd-err)",
};

const STATE_LABEL: Record<MarkState, string> = {
  pending: "待发送",
  staged: "已入对话",
  sent: "已发送",
  drifted: "漂移已重定位",
  lost: "失联",
};

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function cwdRoot(): string | null {
  return getActiveWorkspace()?.root ?? null;
}

/** 注入 CM 运行时类,产出两个 widget 类(仅 editorExtension 工厂闭包消费)。 */
export function createMarkWidgets(cm: { WidgetType: typeof WidgetType }) {
  /* 行末批注 widget:折叠摘要条 / 展开批注卡。note 不进 eq(展开态边写边存
     不重建 widget,保输入焦点);折叠条读 note 预览。 */
  class NoteWidget extends cm.WidgetType {
    constructor(private readonly mark: MarkRuntime) {
      super();
    }

    override eq(other: NoteWidget): boolean {
      return (
        other.mark.id === this.mark.id &&
        other.mark.expanded === this.mark.expanded &&
        other.mark.state === this.mark.state &&
        (this.mark.expanded || other.mark.note === this.mark.note)
      );
    }

    override toDOM(): HTMLElement {
      const { mark } = this;
      const color = STATE_COLOR[mark.state];
      const root = document.createElement("div");
      root.contentEditable = "false";
      if (!mark.expanded) {
        root.className =
          "marks-inline my-0.5 inline-flex max-w-full items-center rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-px text-xs";
        root.innerHTML = `<button type="button" class="cursor-pointer text-(--tmd-fg-muted) hover:text-(--tmd-fg)"><b style="color:${color}">⚑</b> L${mark.startLine}-${mark.endLine} · ${
          mark.note ? escapeHtml(mark.note) : '<span class="opacity-60">点此添加标注</span>'
        } <span class="opacity-60">▾</span></button>`;
        root.querySelector("button")?.addEventListener("click", () => toggleExpanded(mark.id));
        return root;
      }
      root.className =
        "marks-inline my-1 w-fit max-w-full rounded-lg border border-(--tmd-accent) bg-(--tmd-bg-elevated) p-2 text-xs";
      root.innerHTML = `
        <div class="mb-1 flex items-center gap-2">
          <b style="color:${color}">⚑</b>
          <span class="font-mono text-(--tmd-fg-subtle)">L${mark.startLine}-${mark.endLine}</span>
          <span class="rounded-full px-1.5" style="color:${color}">${STATE_LABEL[mark.state]}</span>
        </div>
        <textarea rows="2" class="w-full resize-y rounded-md border border-(--tmd-border) bg-(--tmd-bg-base) p-1.5 text-xs text-(--tmd-fg) outline-none focus:border-(--tmd-accent)" placeholder="写标注,随引用发送到对话…"></textarea>
        <div class="mt-1 flex items-center gap-1.5">
          <button type="button" data-op="send" class="cursor-pointer rounded-md border px-2 py-px" style="border-color:${color};color:${color}">${
            mark.state === "pending" ? "⚑ 发送到对话" : mark.state === "staged" ? "✓ 已入对话" : "↩ 重发"
          }</button>
          <button type="button" data-op="collapse" class="cursor-pointer rounded-md border border-(--tmd-border) px-2 py-px text-(--tmd-fg-muted)">收起 ▴</button>
          <button type="button" data-op="remove" class="ml-auto cursor-pointer rounded-md border border-(--tmd-border) px-2 py-px text-(--tmd-err)">移除</button>
        </div>`;
      const textarea = root.querySelector("textarea");
      if (textarea) {
        textarea.value = mark.note;
        textarea.addEventListener("input", () => {
          const cwd = cwdRoot();
          if (cwd) updateNote(cwd, mark.id, textarea.value);
        });
      }
      root.querySelector('[data-op="collapse"]')?.addEventListener("click", () => toggleExpanded(mark.id));
      root.querySelector('[data-op="remove"]')?.addEventListener("click", () => {
        const cwd = cwdRoot();
        if (cwd) removeMark(cwd, mark.id);
      });
      root.querySelector('[data-op="send"]')?.addEventListener("click", () => {
        const cwd = cwdRoot();
        if (!cwd) return;
        /* 发送到对话 = 翻 staged(composer 芯片条可见,发送时 transform 注入 wire);
           staged 再点 = 撤回 pending;sent 再点 = ↩ 重发回 staged */
        setMarkState(cwd, mark.id, mark.state === "staged" ? "pending" : "staged");
      });
      return root;
    }

    /* true:事件源自 widget 内部(textarea/按钮)时 CM 不处理 ——
       false 会让 CM 抢焦点吞键盘,标注无法填写 */
    override ignoreEvent(): boolean {
      return true;
    }
  }

  /* 选区浮标:非空选区出现「⚑ 标记」,点击把选区行范围落锚(待发送)。 */
  class AddMarkWidget extends cm.WidgetType {
    constructor(
      private readonly from: number,
      private readonly to: number,
      private readonly view: EditorView,
      private readonly path: string,
    ) {
      super();
    }
    override eq(other: AddMarkWidget): boolean {
      return other.from === this.from && other.to === this.to && other.path === this.path;
    }
    /* 同 NoteWidget:widget 内事件不进 CM 处理 */
    override ignoreEvent(): boolean {
      return true;
    }
    override toDOM(): HTMLElement {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "⚑ 标记";
      btn.className =
        "marks-inline mx-1 inline-flex items-center rounded-md border border-(--tmd-warn) bg-(--tmd-bg-base) px-1.5 py-px text-xs hover:bg-(--tmd-bg-hover)";
      btn.addEventListener("mousedown", (event) => event.preventDefault());
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const cwd = cwdRoot();
        const doc = this.view.state.doc;
        if (!cwd) return;
        addMark({
          cwd,
          path: this.path,
          startLine: doc.lineAt(this.from).number,
          endLine: doc.lineAt(this.to).number,
          lines: doc.toString().split("\n"),
        });
      });
      return btn;
    }
  }

  return { NoteWidget, AddMarkWidget };
}
