/**
 * 意图画布 · 列表多选与批量删除状态(移植自 mossx IntentCanvasManager)。
 * Set 为动态成员语义(勾选增删),非静态查表。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Workspace } from "@kernel/workspace";
import type { IntentCanvasIndexEntry } from "../types";
import { deleteIntentCanvasDocuments } from "../storage/documents";

export function useCanvasSelection(input: {
  activeWorkspace: Workspace | null;
  entries: IntentCanvasIndexEntry[];
  filteredEntries: IntentCanvasIndexEntry[];
  refreshIndex: () => Promise<void>;
  /** 任一被删画布正在编辑器中打开时回调(关闭编辑器)。 */
  onDeletedActive: (deletedCanvasIds: string[]) => void;
  /** 删除失败上抛(Manager 落错误条)。 */
  onError: (message: string) => void;
}) {
  const { activeWorkspace, entries, filteredEntries, refreshIndex, onDeletedActive, onError } = input;
  const [selectedCanvasIds, setSelectedCanvasIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeletePromptOpen, setIsBulkDeletePromptOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    setSelectedCanvasIds(new Set<string>());
    setIsBulkDeletePromptOpen(false);
  }, [activeWorkspace?.root]);

  useEffect(() => {
    setSelectedCanvasIds((current) => {
      const availableCanvasIds = new Set(entries.map((entry) => entry.id));
      const next = new Set<string>();
      let changed = false;
      current.forEach((canvasId) => {
        if (availableCanvasIds.has(canvasId)) {
          next.add(canvasId);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [entries]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedCanvasIds.has(entry.id)),
    [entries, selectedCanvasIds],
  );

  const allFilteredEntriesSelected = filteredEntries.length > 0
    && filteredEntries.every((entry) => selectedCanvasIds.has(entry.id));

  const toggleCanvasSelection = useCallback((canvasId: string) => {
    setSelectedCanvasIds((current) => {
      const next = new Set(current);
      if (next.has(canvasId)) {
        next.delete(canvasId);
      } else {
        next.add(canvasId);
      }
      return next;
    });
    setIsBulkDeletePromptOpen(false);
  }, []);

  const toggleFilteredCanvasSelection = useCallback(() => {
    setSelectedCanvasIds((current) => {
      const next = new Set(current);
      const shouldSelectAll = filteredEntries.some((entry) => !next.has(entry.id));
      filteredEntries.forEach((entry) => {
        if (shouldSelectAll) {
          next.add(entry.id);
        } else {
          next.delete(entry.id);
        }
      });
      if (next.size === current.size && Array.from(next).every((canvasId) => current.has(canvasId))) {
        return current;
      }
      return next;
    });
    setIsBulkDeletePromptOpen(false);
  }, [filteredEntries]);

  const clearCanvasSelection = useCallback(() => {
    setSelectedCanvasIds((current) => (current.size === 0 ? current : new Set<string>()));
    setIsBulkDeletePromptOpen(false);
  }, []);

  const selectEraEntries = useCallback((eraEntries: IntentCanvasIndexEntry[]) => {
    setSelectedCanvasIds((current) => {
      const next = new Set(current);
      eraEntries.forEach((entry) => next.add(entry.id));
      return next.size === current.size ? current : next;
    });
    setIsBulkDeletePromptOpen(false);
  }, []);

  const requestBulkDelete = useCallback(() => {
    setIsBulkDeletePromptOpen(true);
  }, []);

  const cancelBulkDelete = useCallback(() => {
    setIsBulkDeletePromptOpen(false);
  }, []);

  const confirmBulkDelete = useCallback(async () => {
    if (!activeWorkspace || selectedEntries.length === 0) {
      return;
    }
    const deletedCanvasIds = selectedEntries.map((entry) => entry.id);
    setIsBulkDeleting(true);
    try {
      await deleteIntentCanvasDocuments(activeWorkspace.root, deletedCanvasIds);
      onDeletedActive(deletedCanvasIds);
      setSelectedCanvasIds(new Set<string>());
      setIsBulkDeletePromptOpen(false);
      await refreshIndex();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBulkDeleting(false);
    }
  }, [activeWorkspace, onDeletedActive, refreshIndex, selectedEntries]);

  return {
    selectedCanvasIds,
    selectedEntries,
    selectedCount: selectedEntries.length,
    allFilteredEntriesSelected,
    isBulkDeletePromptOpen,
    isBulkDeleting,
    toggleCanvasSelection,
    toggleFilteredCanvasSelection,
    clearCanvasSelection,
    selectEraEntries,
    requestBulkDelete,
    cancelBulkDelete,
    confirmBulkDelete,
  };
}
