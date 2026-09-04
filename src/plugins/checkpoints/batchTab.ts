/**
 * 批次 tab 契约 —— 审批线面板与中央批审阅单共同依赖的常量与类型。
 * tab id = `ckpt-batch:<batchId>`;kind = "ckpt-batch";
 * payload 携带 cwd + sessionId(审阅单按同一会话取清单)+ 深链文件。
 */

import { openTab, type EditorTab } from "@kernel/tabs";

const BATCH_TAB_KIND = "ckpt-batch";

interface BatchTabPayload {
  cwd: string;
  sessionId: string;
  /** tmd 会话 id(副键;首锚点落在 CLI 身份绑定前的查询兜底) */
  tmdSessionId?: string;
  batchId: string;
  /** 深链:打开审阅单后滚动到该文件分区并高亮 */
  focusPath?: string;
}

/** 打开(或聚焦)批次审阅单 tab;重复打开刷新 payload(深链目标可能变化)。 */
export function openBatchTab(tab: {
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  batchId: string;
  title: string;
  focusPath?: string;
}): void {
  openTab(
    {
      id: `${BATCH_TAB_KIND}:${tab.batchId}`,
      kind: BATCH_TAB_KIND,
      title: tab.title,
      path: tab.cwd,
      payload: {
        cwd: tab.cwd,
        sessionId: tab.sessionId,
        tmdSessionId: tab.tmdSessionId,
        batchId: tab.batchId,
        focusPath: tab.focusPath,
      },
    },
    { refresh: true },
  );
}

export function readBatchPayload(tab: EditorTab): BatchTabPayload | null {
  if (tab.kind !== BATCH_TAB_KIND) return null;
  const p = tab.payload as Partial<BatchTabPayload> | null;
  if (!p?.cwd || !p.sessionId || !p.batchId) return null;
  return {
    cwd: p.cwd,
    sessionId: p.sessionId,
    tmdSessionId: p.tmdSessionId,
    batchId: p.batchId,
    focusPath: p.focusPath,
  };
}
