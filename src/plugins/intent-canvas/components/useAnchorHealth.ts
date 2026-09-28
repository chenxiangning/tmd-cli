/**
 * 意图画布 · 「更早」分组锚点健康懒检测(移植自 mossx IntentCanvasManager)。
 * 仅 stale 组、并发上限 4、ref 缓存、失败静默降级。
 */

import { useEffect, useRef, useState } from "react";
import type { Workspace } from "@kernel/workspace";
import type { IntentCanvasIndexEntry } from "../types";
import { loadIntentCanvasDocument } from "../storage/documents";
import { documentHasBrokenAnchors, type CanvasAnchorHealth } from "../utils/staleSignals";

export function useAnchorHealth(
  activeWorkspace: Workspace | null,
  staleEraEntries: IntentCanvasIndexEntry[],
): Record<string, CanvasAnchorHealth> {
  const [anchorHealthByCanvasId, setAnchorHealthByCanvasId] = useState<Record<string, CanvasAnchorHealth>>({});
  const anchorHealthCacheRef = useRef<Map<string, CanvasAnchorHealth>>(new Map());

  useEffect(() => {
    anchorHealthCacheRef.current.clear();
    setAnchorHealthByCanvasId({});
  }, [activeWorkspace?.root]);

  useEffect(() => {
    if (!activeWorkspace || staleEraEntries.length === 0) {
      setAnchorHealthByCanvasId((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }
    const cache = anchorHealthCacheRef.current;
    const seeded: Record<string, CanvasAnchorHealth> = {};
    const pending: IntentCanvasIndexEntry[] = [];
    staleEraEntries.forEach((entry) => {
      const cached = cache.get(entry.id);
      if (cached) {
        seeded[entry.id] = cached;
      } else {
        pending.push(entry);
      }
    });
    setAnchorHealthByCanvasId(seeded);
    if (pending.length === 0) {
      return;
    }
    let cancelled = false;
    const root = activeWorkspace.root;
    const queue = [...pending];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (;;) {
        const entry = queue.shift();
        if (!entry || cancelled) {
          return;
        }
        try {
          const canvasDocument = await loadIntentCanvasDocument(root, entry.id);
          const health: CanvasAnchorHealth = documentHasBrokenAnchors(canvasDocument) ? "broken" : "ok";
          cache.set(entry.id, health);
          if (!cancelled) {
            setAnchorHealthByCanvasId((current) => ({ ...current, [entry.id]: health }));
          }
        } catch {
          /* 读取失败静默降级:卡片回退到空图 / N 天未动角标。 */
        }
      }
    });
    void Promise.all(workers);
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace, staleEraEntries]);

  return anchorHealthByCanvasId;
}
