/**
 * 文件文档状态钩子 —— 编辑内容 / 脏标记 / 保存,复刻 codemoss useFileDocumentState:
 *
 * - 初始内容 = 磁盘内容(\r\n 归一),若有未保存草稿则草稿优先(关脏 tab 重开恢复)。
 * - dirty = content !== saved,变化时经 updateTab 同步到 tab 栏圆点。
 * - 保存:写回磁盘(CRLF 还原)→ 刷内容缓存 → 清草稿;失败信息落 footer。
 * - Mod-S:window 捕获阶段拦截(先于编辑器/幕布终端),活动 tab 即保存目标。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@kernel/ipc";
import { updateTab } from "@kernel/tabs";
import {
  cacheRefreshContent,
  draftDelete,
  draftGet,
  draftSet,
  toDiskContent,
  toEditorContent,
} from "./fileCache";

interface FileDocState {
  content: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  setDoc: (value: string) => void;
  save: () => void;
}

export function useFileDocument(path: string, diskContent: string): FileDocState {
  /* 初始化包(stable):归一态磁盘文本 + 是否 CRLF;草稿优先。 */
  const [init] = useState(() => {
    const { text, hasCRLF } = toEditorContent(diskContent);
    const draft = draftGet(path);
    return { saved: text, hasCRLF, initial: draft ?? text };
  });
  const [content, setContent] = useState(init.initial);
  const [saved, setSaved] = useState(init.saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* 行尾标记放 ref:磁盘内容外变(刷新重读)时随新内容更新,保存还原才不会用旧行尾。 */
  const hasCRLFRef = useRef(init.hasCRLF);

  const dirty = content !== saved;

  const contentRef = useRef(content);
  contentRef.current = content;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const savingRef = useRef(false);

  /* 磁盘内容外变(刷新按钮 reloadFile 重读):无未保存草稿时静默跟进新内容;
     有草稿则以编辑态为准,不覆盖用户输入。行尾标记同步更新。 */
  useEffect(() => {
    if (savedRef.current !== contentRef.current) return;
    const { text, hasCRLF } = toEditorContent(diskContent);
    hasCRLFRef.current = hasCRLF;
    if (text === savedRef.current) return;
    setSaved(text);
    setContent(text);
  }, [diskContent]);

  const setDoc = useCallback(
    (value: string) => {
      setContent(value);
      if (value === savedRef.current) draftDelete(path);
      else draftSet(path, value);
    },
    [path],
  );

  const save = useCallback(() => {
    if (savingRef.current) return;
    const text = contentRef.current;
    if (text === savedRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const disk = toDiskContent(text, hasCRLFRef.current);
    ipc.fsWriteFile(path, disk).then(
      () => {
        savingRef.current = false;
        setSaving(false);
        setSaved(text);
        /* 内容缓存原地刷新:预览/重开编辑器立即读到新值,不再走磁盘 IO */
        cacheRefreshContent(path, disk);
        draftDelete(path);
      },
      (e) => {
        savingRef.current = false;
        setSaving(false);
        setError(String(e));
      },
    );
  }, [path, init]);

  /* Mod-S 全局捕获:焦点在编辑器、幕布终端或任意处,保存的都是活动文件 tab。 */
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      e.stopPropagation();
      saveRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /* 脏标记同步到 tab(圆点)。卸载不清理:切走的脏 tab 仍需保持圆点。 */
  useEffect(() => {
    updateTab(`file:${path}`, { dirty });
  }, [path, dirty]);

  return { content, dirty, saving, error, setDoc, save };
}
