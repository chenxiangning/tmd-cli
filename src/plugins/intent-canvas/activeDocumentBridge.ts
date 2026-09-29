/**
 * 画布编辑器当前文档桥 —— 模块级 ref(同 composerInsertRef/marks 桥先例)。
 * Editor 挂载期写入,sendTransform 在发送线程同步读取,不经过 React。
 */

import { openTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import type { IntentCanvasDocument } from "./types";

export const activeDocumentRef: { current: IntentCanvasDocument | null } = { current: null };

/** 反链:打开意图画布 tab 并直达该画布详情(refresh 语义刷新 payload);
 *  独立模块避免组件文件内非组件导出(react-doctor only-export-components)。 */
export function openIntentCanvasBacklink(canvasId: string): void {
  openTab(
    {
      id: "intent-canvas",
      title: t("意图画布"),
      path: "intent-canvas",
      kind: "intent-canvas",
      payload: { canvasId, requestId: Date.now() },
    },
    { refresh: true },
  );
  /* 预热编辑器 chunk(与插件入口同款,反链直达编辑器时免去白屏等待)。 */
  void import("@excalidraw/excalidraw");
}
