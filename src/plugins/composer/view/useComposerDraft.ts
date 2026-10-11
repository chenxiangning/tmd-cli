/**
 * composer 草稿状态与持久化(自 Composer.tsx 拆出守文件规模):
 * - 按 cwd 存 localStorage,挂载恢复、切换工作区换稿(旧稿先落盘);
 * - 发送/清空随 value="" 落盘(发送失败保留草稿 = 持久化自然成立,见 useComposerSend)。
 */

import { useEffect, useRef, useState } from "react";
import { takeQueuedComposerText } from "@kernel/composerExt";

export function useComposerDraft(cwd: string): {
  value: string;
  setValue: React.Dispatch<React.SetStateAction<string>>;
} {
  const draftKeyRef = useRef(`tmd.composerDraft.${cwd}`);
  const [value, setValue] = useState(() => {
    /* 会话创建方预填(如工作台任务包):初始化期消费待注入槽,首帧即正确值。 */
    const queued = takeQueuedComposerText();
    if (queued !== null) return queued;
    try {
      return localStorage.getItem(draftKeyRef.current) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    const key = `tmd.composerDraft.${cwd}`;
    if (key !== draftKeyRef.current) {
      try {
        localStorage.setItem(draftKeyRef.current, value);
      } catch {
        /* 配额满忽略 */
      }
      draftKeyRef.current = key;
      try {
        setValue(localStorage.getItem(key) ?? "");
      } catch {
        setValue("");
      }
      return;
    }
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* 配额满忽略 */
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cwd, value]);
  return { value, setValue };
}
