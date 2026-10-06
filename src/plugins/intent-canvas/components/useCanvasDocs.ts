/**
 * 意图画布 · 文档 CRUD 状态钩子(移植自 mossx IntentCanvasManager 中段)。
 * 存储 = sidecar(按工作区 root);文档展示名 = tmd 工作区 {id, name}。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { Workspace } from "@kernel/workspace";
import type { IntentCanvasDocument, IntentCanvasIndexEntry, IntentCanvasOpenRequest } from "../types";
import { loadIntentCanvasDocument, saveIntentCanvasDocument } from "../storage/documents";
import { appendIntentCanvasDocumentFromRequest, createIntentCanvasDocument } from "../storage/documentOps";
import { normalizeError } from "./EditorShared";

type UseCanvasDocsInput = {
  activeWorkspace: Workspace | null;
  openRequest: IntentCanvasOpenRequest | null;
  onOpenRequestConsumed?: (requestId: number) => void;
  /** openRequest 消费完毕后回调整(切换视图/刷新索引),由 Manager 注入。 */
  refreshIndex: () => Promise<void>;
  /** 保存后直接落列表态(带出写后索引条目,免第三次全量读);未注入回落 refreshIndex。 */
  applyIndexEntries?: (entries: IntentCanvasIndexEntry[]) => void;
  onFatalError: (message: string) => void;
};

export function useCanvasDocs({
  activeWorkspace,
  openRequest,
  onOpenRequestConsumed,
  refreshIndex,
  applyIndexEntries,
  onFatalError,
}: UseCanvasDocsInput) {
  const [activeDocument, setActiveDocument] = useState<IntentCanvasDocument | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const handledOpenRequestIdsRef = useRef<Set<number>>(new Set());

  /* useMemo 固化:防每渲染新对象击穿下游 effect 依赖(评审 P2)。 */
  const workspaceRef = useMemo(
    () => (activeWorkspace ? { id: activeWorkspace.id, name: activeWorkspace.name ?? null } : null),
    [activeWorkspace?.id, activeWorkspace?.name],
  );

  const saveDocument = useCallback(
    async (documentToSave: IntentCanvasDocument) => {
      if (!activeWorkspace) {
        throw new Error(t("请先选择一个工作区后再使用意图画布。"));
      }
      setIsSaving(true);
      try {
        const { document: savedDocument, indexEntries } = await saveIntentCanvasDocument(
          activeWorkspace.root,
          documentToSave,
        );
        setActiveDocument(savedDocument);
        /* 写后条目直接落列表(省一次全量索引读);条目为空 = 索引中止路径
           (抛错走不到这)或空索引,回落全量刷保语义一致。 */
        if (applyIndexEntries && indexEntries.length > 0) applyIndexEntries(indexEntries);
        else await refreshIndex();
        return savedDocument;
      } finally {
        setIsSaving(false);
      }
    },
    [activeWorkspace, applyIndexEntries, refreshIndex],
  );

  const openCanvas = useCallback(
    async (canvasId: string) => {
      if (!activeWorkspace) {
        return;
      }
      try {
        const document = await loadIntentCanvasDocument(activeWorkspace.root, canvasId);
        setActiveDocument(document);
        onFatalError("");
      } catch (error) {
        onFatalError(normalizeError(error));
      }
    },
    [activeWorkspace, onFatalError],
  );

  const createCanvas = useCallback(
    async (request?: IntentCanvasOpenRequest | null) => {
      if (!activeWorkspace || !workspaceRef) {
        onFatalError(t("请先选择一个工作区后再使用意图画布。"));
        return;
      }
      try {
        const document = createIntentCanvasDocument({ workspace: workspaceRef, request });
        const savedDocument = await saveDocument(document);
        setActiveDocument(savedDocument);
        onFatalError("");
      } catch (error) {
        onFatalError(normalizeError(error));
      }
    },
    [activeWorkspace, onFatalError, saveDocument, workspaceRef],
  );

  const appendCanvas = useCallback(
    async (request: IntentCanvasOpenRequest) => {
      try {
        let baseDocument = activeDocument;
        if (request.canvasId && (!baseDocument || baseDocument.id !== request.canvasId)) {
          if (!activeWorkspace) {
            onFatalError(t("请先选择一个工作区后再使用意图画布。"));
            return;
          }
          baseDocument = await loadIntentCanvasDocument(activeWorkspace.root, request.canvasId);
        }
        if (!baseDocument) {
          await createCanvas(request);
          return;
        }
        const nextDocument = appendIntentCanvasDocumentFromRequest({
          document: baseDocument,
          request,
        });
        const savedDocument = await saveDocument(nextDocument);
        setActiveDocument(savedDocument);
        onFatalError("");
      } catch (error) {
        onFatalError(normalizeError(error));
      }
    },
    [activeDocument, activeWorkspace, createCanvas, onFatalError, saveDocument],
  );

  // openRequest 消费:new = 新建 / append = 追加进目标画布 / 指定 canvasId = 打开。
  useEffect(() => {
    if (!openRequest || !activeWorkspace || !workspaceRef) {
      return;
    }
    if (handledOpenRequestIdsRef.current.has(openRequest.requestId)) {
      return;
    }
    handledOpenRequestIdsRef.current.add(openRequest.requestId);
    onOpenRequestConsumed?.(openRequest.requestId);
    const executeRequest = async () => {
      if (openRequest.target === "append") {
        await appendCanvas(openRequest);
      } else if (openRequest.canvasId) {
        await openCanvas(openRequest.canvasId);
      } else {
        await createCanvas(openRequest);
      }
      await refreshIndex();
    };
    // eslint-disable-next-line react-doctor/no-pass-live-state-to-parent -- openRequest 是命令式打开请求,消费只能在 effect;子层无事件源
    void executeRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, openRequest, workspaceRef]);

  return {
    activeDocument,
    setActiveDocument,
    isSaving,
    saveDocument,
    openCanvas,
    createCanvas,
  };
}
