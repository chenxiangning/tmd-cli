//! 行号槽 diff 着色 gutter —— 编辑器内嵌「本文件相对 index 的逐行变更」
//! (CM6 gutter 扩展,editorBlame 同型)。
//!
//! 数据经 setEditorLineDiff 注入(StateEffect);marker 只在变更行出现,
//! 无数据时 gutter 零宽不占位。null = 清除。CM 重库在 load() 内动态加载。
//! lineMarksFromPatch 是 git 单 delta patch 文本 → 逐行标记的纯函数
//! (契约见 kernel/gitContract.GitFilePatch.patch),与 git 插件 patchModel
//! 互不依赖:那边给 diff 视图,这边给编辑器 gutter。

import type { Extension, RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { GutterMarker } from "@codemirror/view";
import type { BlameViewLike } from "./editorBlame";

export type LineMarkKind = "add" | "mod" | "del";
export interface LineMark {
  /** 新文件行号(1 基)。 */
  line: number;
  kind: LineMarkKind;
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 单文件 patch 文本 → gutter 标记集:
 *  - 纯 + 行的连续段 = add(绿);
 *  - 同段含 - 行的 + 行 = mod(蓝,替换语义);
 *  - - 行锚定其后第一个新文件行 = del(红);锚出界夹回 [1, 新文件总行数]。
 *  首个 @@ 前的元数据头整段跳过;\\ 行(No newline)不推进计数。 */
export function lineMarksFromPatch(patch: string): LineMark[] {
  const out: LineMark[] = [];
  const delAnchors = new Set<number>();
  let newLine = 0;
  let total = 0;
  let inHunk = false;
  let runAdds: number[] = [];
  let runHasDel = false;
  const flushRun = () => {
    const kind: LineMarkKind = runHasDel ? "mod" : "add";
    for (const ln of runAdds) out.push({ line: ln, kind });
    runAdds = [];
    runHasDel = false;
  };
  for (const raw of patch.split("\n")) {
    const c = raw[0];
    if (c === "@" && raw.startsWith("@@")) {
      flushRun();
      const m = HUNK_RE.exec(raw);
      if (m) {
        inHunk = true;
        newLine = Number(m[1]);
        total = Math.max(total, newLine - 1);
      }
      continue;
    }
    if (!inHunk) continue; // 元数据头
    if (c === "+") {
      runAdds.push(newLine);
      newLine++;
      total = Math.max(total, newLine - 1);
    } else if (c === "-") {
      runHasDel = true;
      delAnchors.add(newLine);
    } else if (c === "\\") {
      continue;
    } else {
      flushRun(); // ctx 行终结一段增删
      newLine++;
      total = Math.max(total, newLine - 1);
    }
  }
  flushRun();
  for (const a of delAnchors) {
    out.push({ line: Math.max(1, Math.min(a, total)), kind: "del" });
  }
  out.sort((x, y) => x.line - y.line);
  return out;
}

interface DiffGutterApi {
  setMarksOf: (value: RangeSet<GutterMarker> | null) => StateEffect<unknown>;
  marksField: StateField<RangeSet<GutterMarker>>;
  makeGutter: () => Extension;
  newMarker: (kind: LineMarkKind) => GutterMarker;
  newBuilder: () => RangeSetBuilder<GutterMarker>;
}

let apiP: Promise<DiffGutterApi> | null = null;
/** 单例装配:首次调用拉起 CM 模块并定义 effect/field/gutter,后续共享。 */
async function load(): Promise<DiffGutterApi> {
  apiP ??= Promise.all([import("@codemirror/state"), import("@codemirror/view")]).then(([s, v]) => {
    const setMarks = s.StateEffect.define<RangeSet<DiffMarker> | null>();
    class DiffMarker extends v.GutterMarker {
      constructor(readonly kind: LineMarkKind) {
        super();
      }
      override eq(other: GutterMarker): boolean {
        return other instanceof DiffMarker && other.kind === this.kind;
      }
      override toDOM(): HTMLElement {
        const el = document.createElement("div");
        el.className = `cm-dlg cm-dlg-${this.kind}`;
        return el;
      }
    }
    const marksField = s.StateField.define<RangeSet<GutterMarker>>({
      create: () => s.RangeSet.empty as RangeSet<GutterMarker>,
      update(set, tr): RangeSet<GutterMarker> {
        for (const e of tr.effects) if (e.is(setMarks)) return e.value ?? (s.RangeSet.empty as RangeSet<GutterMarker>);
        return set.map(tr.changes);
      },
    });
    return {
      setMarksOf: (value) => setMarks.of(value as RangeSet<DiffMarker> | null),
      marksField,
      makeGutter: (): Extension =>
        v.gutter({
          class: "cm-diffGutter",
          markers: (view) => view.state.field(marksField, false) ?? s.RangeSet.empty,
        }),
      newMarker: (kind) => new DiffMarker(kind),
      newBuilder: () => new s.RangeSetBuilder<GutterMarker>(),
    };
  });
  return apiP;
}

/** 挂载期加入基础扩展(field 必须同挂,markers 回调依赖它)。 */
export async function editorDiffGutterExtension(): Promise<Extension> {
  const a = await load();
  return [a.marksField, a.makeGutter()];
}

/** 注入/清除逐行变更标记;行号超界(文件已变)静默跳过,builder 要求有序。 */
export async function setEditorLineDiff(
  view: BlameViewLike,
  marks: readonly LineMark[] | null,
): Promise<void> {
  const a = await load();
  if (!marks || marks.length === 0) {
    view.dispatch({ effects: a.setMarksOf(null) });
    return;
  }
  const builder = a.newBuilder();
  for (const m of marks) {
    if (m.line < 1 || m.line > view.state.doc.lines) continue;
    const from = view.state.doc.line(m.line).from;
    builder.add(from, from, a.newMarker(m.kind));
  }
  view.dispatch({ effects: a.setMarksOf(builder.finish()) });
}
