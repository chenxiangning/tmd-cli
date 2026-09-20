//! blame gutter —— 编辑器内嵌 Git 逐行归属(CM6 gutter 扩展)。
//!
//! 数据经 setEditorBlame 注入(StateEffect);marker 定位在行首,gutter 宽度
//! 由 CSS 钉死(.cm-blameGutter),代码列不随元数据抖动。null = 清除(隐藏模式)。
//! CM 重库在 load() 内动态加载(cmTheme/cmLanguage 同款纪律,静态图零重库);
//! 类型经 typeof import() 全程静态可查,无 any。

import type { Extension } from "@codemirror/state";

/** kernel/gitContract.GitBlameLine 的结构子集(避免内核内环依赖)。 */
export interface BlameRow {
  lineNo: number;
  shortSha: string;
  summary: string;
  authorName: string;
  authorWhen: number;
  boundary: boolean;
  /** 预渲染元数据文本(调用方拼好,本模块不认时间格式)。 */
  label: string;
}

/** setEditorBlame 的宿主视图:只承诺 dispatch + 行号换位(结构面,勿传任意对象)。 */
export interface BlameViewLike {
  dispatch(spec: unknown): void;
  state: { doc: { lines: number; line(n: number): { from: number } } };
}

type BlameRangeSet = import("@codemirror/state").RangeSet<import("@codemirror/view").GutterMarker>;

interface BlameApi {
  setBlameOf: (value: BlameRangeSet | null) => import("@codemirror/state").StateEffect<unknown>;
  blameField: import("@codemirror/state").StateField<BlameRangeSet>;
  makeGutter: () => Extension;
  newMarker: (label: string, detail: string, boundary: boolean) => import("@codemirror/view").GutterMarker;
  newBuilder: () => import("@codemirror/state").RangeSetBuilder<import("@codemirror/view").GutterMarker>;
}

let apiP: Promise<BlameApi> | null = null;
/** 单例装配:首次调用拉起 CM 模块并定义 effect/field/gutter,后续共享。 */
function load(): Promise<BlameApi> {
  if (!apiP) {
    apiP = Promise.all([import("@codemirror/state"), import("@codemirror/view")]).then(([s, v]) => {
      const setBlame = s.StateEffect.define<import("@codemirror/state").RangeSet<BlameMarker> | null>();
      class BlameMarker extends v.GutterMarker {
        constructor(
          readonly label: string,
          readonly detail: string,
          readonly boundary: boolean,
        ) {
          super();
        }
        override eq(other: import("@codemirror/view").GutterMarker): boolean {
          return other instanceof BlameMarker && other.label === this.label && other.boundary === this.boundary;
        }
        override toDOM(): HTMLElement {
          const el = document.createElement("div");
          el.className = this.boundary ? "cm-blame-cell cm-blame-boundary" : "cm-blame-cell";
          el.textContent = this.label;
          if (this.detail) el.title = this.detail;
          return el;
        }
      }
      const blameField = s.StateField.define<import("@codemirror/state").RangeSet<BlameMarker>>({
        create: () => s.RangeSet.empty,
        update(set, tr) {
          for (const e of tr.effects) if (e.is(setBlame)) return e.value ?? s.RangeSet.empty;
          return set.map(tr.changes);
        },
      });
      return {
        setBlameOf: (value) => setBlame.of(value as import("@codemirror/state").RangeSet<BlameMarker> | null),
        blameField,
        makeGutter: (): Extension =>
          v.gutter({
            class: "cm-blameGutter",
            markers: (view) => view.state.field(blameField, false) ?? s.RangeSet.empty,
          }),
        newMarker: (label, detail, boundary) => new BlameMarker(label, detail, boundary),
        newBuilder: () => new s.RangeSetBuilder<import("@codemirror/view").GutterMarker>(),
        empty: s.RangeSet.empty,
      };
    });
  }
  return apiP;
}

/** 挂载期加入基础扩展(field 必须同挂,markers 回调依赖它)。 */
export async function editorBlameExtension(): Promise<Extension> {
  const a = await load();
  return [a.blameField, a.makeGutter()];
}

/** 注入/清除 blame 数据;行号超界(文件已变)静默跳过,builder 要求有序。 */
export async function setEditorBlame(
  view: BlameViewLike,
  rows: readonly BlameRow[] | null,
): Promise<void> {
  const a = await load();
  if (!rows || rows.length === 0) {
    view.dispatch({ effects: a.setBlameOf(null) });
    return;
  }
  const builder = a.newBuilder();
  for (const r of rows) {
    if (r.lineNo < 1 || r.lineNo > view.state.doc.lines) continue;
    const from = view.state.doc.line(r.lineNo).from;
    builder.add(from, from, a.newMarker(r.label, r.boundary ? r.summary : "", r.boundary));
  }
  view.dispatch({ effects: a.setBlameOf(builder.finish()) });
}
