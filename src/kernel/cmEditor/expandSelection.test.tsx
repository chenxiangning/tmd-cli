/**
 * ⌘W 扩大选择退化路径(expandSelectionFallback)契约:
 * 光标在某词内 → 整词入选;词已整选/无词可扩 → 不动作(不 dispatch)。
 * selectSyntaxTree 主路径是 @codemirror/commands 自带件(信任),此处只测退化词选择。
 * vitest 为 node 环境(无 DOM),用最小 view 桩驱动;真件渲染归 tauri:dev 目检。
 */

import { describe, expect, it, vi, type Mock } from "vitest";
import { expandSelectionFallback } from "./expandSelection";

/** 最小 view 桩:wordAt 用词表线性匹配,dispatch 记录调用。 */
function fakeView(doc: string, head: number) {
  const dispatch = vi.fn();
  const wordAt = (pos: number): { from: number; to: number } | null => {
    for (const m of doc.matchAll(/\S+/g)) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        return { from: m.index, to: m.index + m[0].length };
      }
    }
    return null;
  };
  const view = {
    state: {
      selection: { main: { head, from: head, to: head, empty: true } },
      wordAt,
      sliceDoc: (from: number, to: number) => doc.slice(from, to),
    },
    dispatch,
  };
  return { view, dispatch: dispatch as unknown as Mock };
}

describe("expandSelectionFallback(⌘W 退化词选择)", () => {
  it("光标在某词内:整词入选", () => {
    const { view, dispatch } = fakeView("hello world", 8);
    expandSelectionFallback(view as never);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].selection).toEqual({ anchor: 6, head: 11 });
  });

  it("光标处无词(空白内):不动作", () => {
    const { view, dispatch } = fakeView("a   b", 2);
    expandSelectionFallback(view as never);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
