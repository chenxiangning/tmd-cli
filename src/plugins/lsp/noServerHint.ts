/**
 * 配置外语言(四语言之外)的轻提示扩展 —— 不建会话,仅挂 cmd/ctrl+click
 * 手势:首次给「此语言无语言服务」toast(gestureNotice 60s 节流),
 * 返回 false 不拦截原生点击语义。拆包红线:@codemirror 运行期动态 import。
 */
import type { Extension } from "@codemirror/state";
import { t } from "@kernel/i18n";
import { showGestureNotice } from "./gestureNotice";

export function noServerHintExtension(): Promise<Extension[]> {
  return import("@codemirror/view").then(({ EditorView }) => [
    EditorView.domEventHandlers({
      mousedown(event) {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false;
        showGestureNotice("no-language", t("此语言无语言服务"));
        return false;
      },
    }),
  ]);
}
