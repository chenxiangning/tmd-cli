/**
 * 文件文档状态钩子 —— 编辑内容 / 脏标记 / 保存,复刻 codemoss useFileDocumentState:
 *
 * - 初始内容 = 磁盘内容(\r\n 归一),若有未保存草稿则草稿优先(关脏 tab 重开恢复)。
 * - dirty = content !== saved,变化时经 updateTab 同步到 tab 栏圆点。
 * - 保存:写回磁盘(CRLF 还原)→ 刷内容缓存 → 清草稿;失败信息落 footer。
 * - 保存触发:files.save(⌘S)命令经模块级 saveRequestRef 桥进来,活动 tab 即保存目标。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "@kernel/ipc";
import { updateTab } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { isRemoteFileUri } from "@kernel/fileSources";
import {
  cacheRefreshContent,
  draftDelete,
  draftGet,
  draftSet,
  toDiskContent,
  toEditorContent,
} from "./fileCache";

/** files.save 命令桥:挂载中的文件编辑器实例经此接收保存触发(先例 TerminalView.findRequestRef)。 */
export const saveRequestRef: { current: (() => void) | null } = { current: null };

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
  const savedRef = useRef(saved);
  const savingRef = useRef(false);
  /* ref 镜像在 effect 内同步(渲染期写 ref 违反 React 渲染纯性,react-doctor 强报)。 */
  useEffect(() => {
    contentRef.current = content;
    savedRef.current = saved;
  }, [content, saved]);


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
    if (isRemoteFileUri(path)) {
      /* 远程 M1 无写回通道;编辑器已 readOnly,此处兜底 ⌘S 直呼 */
      setError(t("远程文件暂不支持写入(M1)"));
      return;
    }
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
  }, [path]);

  /* 保存请求桥:⌘S 命令(files.save)注册口经此触发最新 save;卸载即摘除,
     非文件 tab 下 when 不满足,键穿透。 */
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
    saveRequestRef.current = () => saveRef.current();
    return () => {
      saveRequestRef.current = null;
    };
  }, [save]);

  /* 脏标记同步到 tab(圆点)。卸载不清理:切走的脏 tab 仍需保持圆点。 */
  useEffect(() => {
    updateTab(`file:${path}`, { dirty });
  }, [path, dirty]);

  return { content, dirty, saving, error, setDoc, save };
}
