/**
 * 意图画布 · 管理器(移植自 mossx IntentCanvasManager,钩子拆分见同目录 use*)。
 * 视图路由:无工作区空态 / 编辑器 / 列表 home;消费 openRequest;
 * AI 作画 inbox 轮询经 useAiDrawInbox 挂载。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { host, useHost } from "@kernel/host";
import { openFileAtLine } from "@kernel/fileTabs";
import { useWorkspaces } from "@kernel/workspace";
import type { IntentCanvasDocument, IntentCanvasIndexEntry, IntentCanvasOpenRequest } from "../types";
import { deleteIntentCanvasDocument, loadIntentCanvasDocument, loadIntentCanvasIndex } from "../storage/documents";
import { cloneIntentCanvasDocument } from "../storage/documentOps";
import { groupCanvasEntriesByEra, type CanvasEra } from "../utils/eraGrouping";
import { useCanvasDocs } from "./useCanvasDocs";
import { useAnchorHealth } from "./useAnchorHealth";
import { useCanvasSelection } from "./useCanvasSelection";
import { useAiDrawInbox } from "../useAiDrawInbox";
import { stageAttachment } from "../store";
import { setAiDrawEnabled, useAiDrawEnabled } from "../aiDrawStore";
import { activeDocumentRef } from "../activeDocumentBridge";
import { normalizeError, type IntentCanvasOpenSourceFile } from "./EditorShared";
import { IntentCanvasEditor } from "./IntentCanvasEditor";
import { IntentCanvasHome, type IntentCanvasHomeStatus } from "./manager-home/IntentCanvasHome";

const EMPTY_CANVAS_ENTRIES: IntentCanvasIndexEntry[] = [];

export type IntentCanvasManagerProps = {
  openRequest?: IntentCanvasOpenRequest | null;
  onOpenRequestConsumed?: (requestId: number) => void;
};

type IntentCanvasManagerAction = "open" | "duplicate" | "delete";

type IntentCanvasActionPrompt = {
  action: IntentCanvasManagerAction;
  entry: IntentCanvasIndexEntry;
};

export function IntentCanvasManager({
  openRequest = null,
  onOpenRequestConsumed,
}: IntentCanvasManagerProps) {
  /* 订阅式取活动工作区:boot 异步完成/切换时驱动重渲染(getActiveWorkspace 非响应式)。 */
  const { list: workspaceList, activeId } = useWorkspaces();
  const activeWorkspace = workspaceList.find((w) => w.id === activeId) ?? null;
  const hostTick = useHost();
  const activeThreadId = host.getActiveSessionId();
  void hostTick;

  const [status, setStatus] = useState<IntentCanvasHomeStatus>("idle");
  const [entries, setEntries] = useState<IntentCanvasIndexEntry[]>(EMPTY_CANVAS_ENTRIES);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [aiDrawNotice, setAiDrawNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionPrompt, setActionPrompt] = useState<IntentCanvasActionPrompt | null>(null);
  const [confirmingCanvasActionId, setConfirmingCanvasActionId] = useState<string | null>(null);
  const aiDrawEnabled = useAiDrawEnabled();

  const refreshIndex = useCallback(async () => {
    if (!activeWorkspace) {
      setEntries(EMPTY_CANVAS_ENTRIES);
      setWarnings([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const result = await loadIntentCanvasIndex(activeWorkspace.root);
    setEntries(result.value);
    setWarnings(result.warnings);
    setStatus("ready");
  }, [activeWorkspace?.root]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    /* 切工作区:编辑器不残留旧工作区文档(saveDocument 会写进新桶造成跨桶复制)。 */
    docs.setActiveDocument(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.root]);

  useEffect(() => {
    let cancelled = false;
    if (!activeWorkspace) {
      setEntries(EMPTY_CANVAS_ENTRIES);
      setWarnings([]);
      setErrorMessage(null);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    loadIntentCanvasIndex(activeWorkspace.root)
      .then((result) => {
        if (!cancelled) {
          setEntries(result.value);
          setWarnings(result.warnings);
          setStatus("ready");
          setErrorMessage(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage(normalizeError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.root]); // eslint-disable-line react-hooks/exhaustive-deps

  const docs = useCanvasDocs({
    activeWorkspace,
    openRequest,
    onOpenRequestConsumed,
    refreshIndex,
    onFatalError: (message) => setErrorMessage(message || null),
  });

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return entries;
    }
    return entries.filter((entry) => {
      const searchable = [entry.title, entry.summary, entry.mode, entry.path].join(" ").toLowerCase();
      return searchable.includes(query);
    });
  }, [entries, searchQuery]);

  const [renderNow, setRenderNow] = useState(() => new Date());
  useEffect(() => {
    /* 索引重载时刷新分桶基准时间;搜索输入不移动 era 边界。 */
    setRenderNow(new Date());
  }, [entries]);
  const canvasEras = useMemo(
    () => groupCanvasEntriesByEra(filteredEntries, renderNow),
    [filteredEntries, renderNow],
  );
  const staleEraEntries = useMemo(
    () => canvasEras.find((era) => era.kind === "stale")?.entries ?? EMPTY_CANVAS_ENTRIES,
    [canvasEras],
  );

  const anchorHealthByCanvasId = useAnchorHealth(activeWorkspace, staleEraEntries);

  const selection = useCanvasSelection({
    activeWorkspace,
    entries,
    filteredEntries,
    refreshIndex,
    onError: (message) => setErrorMessage(message),
    onDeletedActive: (deletedCanvasIds) => {
      if (docs.activeDocument && deletedCanvasIds.includes(docs.activeDocument.id)) {
        docs.setActiveDocument(null);
      }
      setActionPrompt(null);
    },
  });

  const aiDrawImportError = useAiDrawInbox(activeWorkspace, (titles) => {
    void refreshIndex();
    setAiDrawNotice(t("AI 作画已上画布:{titles}", { titles: titles.join("、") }));
  });

  /* 编辑器当前文档桥 + 打开态兜底:批量删除/切工作区后编辑器不残留已删文档。 */
  useEffect(() => {
    activeDocumentRef.current = docs.activeDocument;
  }, [docs.activeDocument]);

  const handleCanvasActionRequest = useCallback(
    (entry: IntentCanvasIndexEntry, action: IntentCanvasManagerAction) => {
      /* 打开是非破坏动作,直接切换编辑器;复制/删除才走确认气泡。 */
      if (action === "open") {
        void docs.openCanvas(entry.id);
        return;
      }
      setActionPrompt((current) =>
        current?.entry.id === entry.id && current.action === action ? null : { action, entry },
      );
    },
    [docs],
  );

  const confirmCanvasAction = useCallback(async () => {
    if (!actionPrompt || !activeWorkspace) {
      return;
    }
    const { action, entry } = actionPrompt;
    setConfirmingCanvasActionId(entry.id);
    try {
      if (action === "duplicate") {
        const sourceDocument = await loadIntentCanvasDocument(activeWorkspace.root, entry.id);
        const copiedDocument = cloneIntentCanvasDocument({
          workspace: { id: activeWorkspace.id, name: activeWorkspace.name ?? null },
          source: sourceDocument,
        });
        const savedDocument = await docs.saveDocument(copiedDocument);
        docs.setActiveDocument(savedDocument);
      } else {
        await deleteIntentCanvasDocument(activeWorkspace.root, entry.id);
        if (docs.activeDocument?.id === entry.id) {
          docs.setActiveDocument(null);
        }
        await refreshIndex();
      }
      setActionPrompt(null);
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setConfirmingCanvasActionId(null);
    }
  }, [actionPrompt, activeWorkspace, docs, refreshIndex, selection]);

  const handleAttachToThread = useCallback(
    (document: IntentCanvasDocument) => {
      stageAttachment(activeThreadId, document);
    },
    [activeThreadId],
  );

  const handleOpenSourceFile: IntentCanvasOpenSourceFile = useCallback((path, location) => {
    openFileAtLine(path, location?.line ?? 1);
  }, []);

  if (!activeWorkspace) {
    return (
      <section className="intent-canvas-manager is-empty">
        <div className="intent-canvas-empty-state">
          <FolderOpen aria-hidden />
          <h2>{t("请选择工作区")}</h2>
          <p>{t("意图画布按工作区存放在 ~/.tmd-cli/intent-canvas 目录。")}</p>
        </div>
      </section>
    );
  }

  if (docs.activeDocument) {
    return (
      <IntentCanvasEditor
        document={docs.activeDocument}
        activeThreadId={activeThreadId}
        isSaving={docs.isSaving}
        onBack={() => {
          docs.setActiveDocument(null);
          void refreshIndex();
        }}
        onSave={docs.saveDocument}
        onAttachToThread={handleAttachToThread}
        onOpenSourceFile={handleOpenSourceFile}
        managerErrorMessage={errorMessage}
      />
    );
  }

  return (
    <section className="intent-canvas-manager" aria-label={t("意图画布管理")}>
      <IntentCanvasHome
        status={status}
        filteredEntries={filteredEntries}
        eras={canvasEras}
        now={renderNow}
        warnings={warnings}
        errorMessage={errorMessage}
        aiDrawNotice={aiDrawNotice}
        aiDrawError={aiDrawImportError}
        aiDrawEnabled={aiDrawEnabled}
        onToggleAiDraw={() => setAiDrawEnabled(!aiDrawEnabled)}
        searchQuery={searchQuery}
        anchorHealthByCanvasId={anchorHealthByCanvasId}
        selectedCanvasIds={selection.selectedCanvasIds}
        selectedCount={selection.selectedCount}
        allFilteredEntriesSelected={selection.allFilteredEntriesSelected}
        isBulkDeletePromptOpen={selection.isBulkDeletePromptOpen}
        isBulkDeleting={selection.isBulkDeleting}
        actionPrompt={actionPrompt}
        confirmingCanvasActionId={confirmingCanvasActionId}
        onSearchQueryChange={setSearchQuery}
        onToggleSelectAll={selection.toggleFilteredCanvasSelection}
        onRefresh={() => void refreshIndex()}
        onCreateCanvas={() => void docs.createCanvas()}
        onToggleCanvasSelection={selection.toggleCanvasSelection}
        onSelectEra={(era: CanvasEra) => selection.selectEraEntries(era.entries)}
        onClearSelection={selection.clearCanvasSelection}
        onBulkDeleteRequest={selection.requestBulkDelete}
        onBulkDeleteConfirm={() => void selection.confirmBulkDelete()}
        onBulkDeleteCancel={selection.cancelBulkDelete}
        onCanvasActionRequest={handleCanvasActionRequest}
        onConfirmCanvasAction={() => void confirmCanvasAction()}
        onCancelCanvasAction={() => setActionPrompt(null)}
      />
    </section>
  );
}
