/**
 * AI 作画 inbox 导入订阅钩子(轮询已上移插件 activate 级常驻定时,见
 * aiDrawPoller.ts):本钩子只订 aiDrawStore 的导入 notice —— 画布 tab 开着时
 * 照旧刷新索引 + 亮导入提示条;tab 关闭不再停扫(导入仍发生,通知走
 * composer rail toast / 失焦 OS 通知)。返回轮询错误串供管理页错误条。
 */

import { useEffect, useRef, useState } from "react";
import {
  aiDrawImportNoticeSnapshot,
  aiDrawPollErrorSnapshot,
  subscribeAiDraw,
} from "./aiDrawStore";

export function useAiDrawInbox(
  onImported: (imported: { id: string; title: string }[]) => void,
): string | null {
  /* 惰性初值:挂载前轮询已记错也要立刻可见(订阅只在后续变化时触发)。 */
  const [lastError, setLastError] = useState<string | null>(aiDrawPollErrorSnapshot);
  const onImportedRef = useRef(onImported);

  useEffect(() => {
    onImportedRef.current = onImported;
  }, [onImported]);

  useEffect(() => {
    /* 挂载快照为基线:组件重挂/切 tab 不重放历史导入。 */
    let lastSeq = aiDrawImportNoticeSnapshot()?.seq ?? 0;
    const off = subscribeAiDraw(() => {
      const notice = aiDrawImportNoticeSnapshot();
      if (notice && notice.seq !== lastSeq) {
        lastSeq = notice.seq;
        onImportedRef.current(notice.canvases);
      }
      setLastError(aiDrawPollErrorSnapshot());
    });
    return off;
  }, []);

  return lastError;
}
