/**
 * AI 作画 inbox 轮询钩子:画布 tab 挂载期每 2s 扫一次 inbox(无 fs watch 原语,
 * ponytail: 用户显式要实时性再上 Rust notify)。导入成功回调刷新索引;
 * 同时维护 aiDrawPrompt 的 inbox 路径缓存与导入提示条状态。
 */

import { useEffect, useRef, useState } from "react";
import type { Workspace } from "@kernel/workspace";
import { cacheAiDrawInboxPath } from "./aiDrawPrompt";
import { aiDrawInboxPath, pollAiDrawInbox } from "./aiDraw";

export const AI_DRAW_POLL_MS = 2000;

export function useAiDrawInbox(
  activeWorkspace: Workspace | null,
  onImported: (imported: { id: string; title: string }[]) => void,
  enabled = true,
): string | null {
  const [lastError, setLastError] = useState<string | null>(null);
  const onImportedRef = useRef(onImported);

  useEffect(() => {
    onImportedRef.current = onImported;
  }, [onImported]);

  /* eslint-disable react-doctor/no-set-state-after-await-in-effect --
     tick 内 setLastError 均有 cancelled 旗标闸(组件卸载/工作区切换后不再写),
     乱序竞态已被闸死。 */
  useEffect(() => {
    if (!activeWorkspace || !enabled) {
      return;
    }
    const root = activeWorkspace.root;
    let cancelled = false;
    aiDrawInboxPath(root)
      .then((inbox) => {
        if (!cancelled) {
          cacheAiDrawInboxPath(root, inbox);
        }
      })
      .catch(() => undefined);
    let running = false;
    const tick = async () => {
      /* in-flight 闸:慢盘上单轮超过 2s 时跳过本轮,防同一批文件重复导入。 */
      if (running) {
        return;
      }
      running = true;
      try {
        const imported = await pollAiDrawInbox(root, {
          id: activeWorkspace.id,
          name: activeWorkspace.name,
        });
        if (!cancelled && imported.length > 0) {
          setLastError(null);
          onImportedRef.current(imported);
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), AI_DRAW_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeWorkspace, enabled]);

  return lastError;
}
